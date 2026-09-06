import { spawn } from 'node:child_process';

import {
  AnnotationRect,
  AnnotationType,
  PdfAnnotation,
  PdfAnnotationSchema,
} from '@/domain/annotation';
import { getPythonCommand } from '@/lib/pdf/python-runtime';

export type PdfAnnotationWorkerAction = 'list' | 'create' | 'update' | 'delete';

export interface CreatePdfAnnotationPayload {
  readonly pdf_page_index: number;
  readonly type: AnnotationType;
  readonly text: string;
  readonly note: string;
  readonly rects: AnnotationRect[];
}

export interface UpdatePdfAnnotationPayload {
  readonly annotation_id: string;
  readonly type?: AnnotationType;
  readonly text?: string;
  readonly note?: string;
}

interface WorkerResponse {
  readonly annotations?: unknown[];
  readonly annotation?: unknown | null;
  readonly found?: boolean;
}

const PYTHON_PDF_ANNOTATION_SCRIPT = String.raw`
import io
import json
import os
import sys
import tempfile

import fitz

fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)
OUTPUT = sys.stdout
sys.stdout = io.StringIO()

IMPORTANT_COLOR = (0.9882352941, 0.6980392157, 0.3490196078)
UNKNOWN_COLOR = (0.9960784314, 0.5372549020, 0.5137254902)
LUMER_PAYLOAD_VERSION = "lumer-v1"


def clamp(value):
    return max(0.0, min(1.0, float(value)))


def group_vertices(vertices):
    if not vertices:
        return []
    return [vertices[index:index + 4] for index in range(0, len(vertices), 4)]


def rect_from_points(points):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return fitz.Rect(min(xs), min(ys), max(xs), max(ys))


def normalized_rect(rect, page_rect):
    x = clamp(rect.x0 / page_rect.width)
    y = clamp(rect.y0 / page_rect.height)
    width = clamp(rect.width / page_rect.width)
    height = clamp(rect.height / page_rect.height)
    width = min(width, 1.0 - x)
    height = min(height, 1.0 - y)
    return {"x": x, "y": y, "width": width, "height": height}


def quad_from_normalized_rect(rect, page_rect):
    x0 = float(rect["x"]) * page_rect.width
    y0 = float(rect["y"]) * page_rect.height
    x1 = x0 + float(rect["width"]) * page_rect.width
    y1 = y0 + float(rect["height"]) * page_rect.height
    absolute = fitz.Rect(x0, y0, x1, y1)
    return fitz.Quad(absolute.tl, absolute.tr, absolute.bl, absolute.br)


def decode_content(info):
    content = str((info or {}).get("content") or "").strip()
    if not content:
        return {"text": "", "note": ""}
    try:
        payload = json.loads(content)
        if payload.get("lumer") == LUMER_PAYLOAD_VERSION:
            return {
                "text": str(payload.get("text") or ""),
                "note": str(payload.get("note") or ""),
            }
    except Exception:
        pass
    return {"text": content, "note": ""}


def encode_content(text, note):
    return json.dumps({
        "lumer": LUMER_PAYLOAD_VERSION,
        "text": text,
        "note": note,
    }, ensure_ascii=False, separators=(",", ":"))


def annotation_type(annotation):
    subject = str((annotation.info or {}).get("subject") or "").strip().lower()
    return subject if subject in ("important", "unknown") else "important"


def annotation_text(page, annotation, decoded):
    if decoded["text"].strip():
        return decoded["text"].strip()
    return page.get_textbox(annotation.rect).strip()


def export_annotation(page_index, page, annotation):
    rects = []
    vertices = getattr(annotation, "vertices", None)
    if vertices:
        for points in group_vertices(vertices):
            rects.append(normalized_rect(rect_from_points(points), page.rect))
    if not rects:
        rects = [normalized_rect(annotation.rect, page.rect)]
    decoded = decode_content(annotation.info or {})
    return {
        "annotation_id": str(annotation.xref),
        "pdf_page_index": page_index,
        "display_page_number": page_index + 1,
        "type": annotation_type(annotation),
        "text": annotation_text(page, annotation, decoded),
        "note": decoded["note"],
        "rects": rects,
    }


def find_annotation(document, annotation_id):
    target = int(annotation_id)
    for page_index in range(document.page_count):
        page = document[page_index]
        annotation = page.first_annot
        while annotation:
            if annotation.xref == target and annotation.type and annotation.type[1] == "Highlight":
                return page_index, page, annotation
            annotation = annotation.next
    return None


def collect_annotations(document):
    values = []
    for page_index in range(document.page_count):
        page = document[page_index]
        annotation = page.first_annot
        while annotation:
            if annotation.type and annotation.type[1] == "Highlight":
                exported = export_annotation(page_index, page, annotation)
                if exported["text"]:
                    values.append(exported)
            annotation = annotation.next
    return values


def save_document(document, pdf_path):
    try:
        document.saveIncr()
        return document
    except Exception:
        handle, temp_path = tempfile.mkstemp(suffix=".pdf", dir=os.path.dirname(pdf_path))
        os.close(handle)
        document.save(temp_path, deflate=True)
        document.close()
        os.replace(temp_path, pdf_path)
        return fitz.open(pdf_path)


payload = json.load(sys.stdin)
action = payload["action"]
pdf_path = payload["pdf_path"]
document = fitz.open(pdf_path)

try:
    if action == "list":
        result = {"annotations": collect_annotations(document)}
    elif action == "create":
        item = payload["annotation"]
        page_index = int(item["pdf_page_index"])
        if page_index < 0 or page_index >= document.page_count:
            raise ValueError("pdf_page_index is outside the PDF")
        page = document[page_index]
        quads = [quad_from_normalized_rect(rect, page.rect) for rect in item["rects"]]
        annotation = page.add_highlight_annot(quads)
        value_type = item["type"]
        color = UNKNOWN_COLOR if value_type == "unknown" else IMPORTANT_COLOR
        annotation.set_colors(stroke=color)
        annotation.set_info(
            title="Lumer",
            subject=value_type,
            content=encode_content(item["text"], item["note"]),
        )
        annotation.update()
        annotation_id = str(annotation.xref)
        document = save_document(document, pdf_path)
        located = find_annotation(document, annotation_id)
        result = {
            "found": located is not None,
            "annotation": export_annotation(*located) if located else None,
        }
    elif action == "update":
        item = payload["annotation"]
        located = find_annotation(document, item["annotation_id"])
        if not located:
            result = {"found": False, "annotation": None}
        else:
            page_index, page, annotation = located
            decoded = decode_content(annotation.info or {})
            value_type = item.get("type", annotation_type(annotation))
            value_text = item.get("text", annotation_text(page, annotation, decoded))
            value_note = item.get("note", decoded["note"])
            color = UNKNOWN_COLOR if value_type == "unknown" else IMPORTANT_COLOR
            annotation.set_colors(stroke=color)
            annotation.set_info(
                title="Lumer",
                subject=value_type,
                content=encode_content(value_text, value_note),
            )
            annotation.update()
            annotation_id = str(annotation.xref)
            document = save_document(document, pdf_path)
            updated = find_annotation(document, annotation_id)
            result = {
                "found": updated is not None,
                "annotation": export_annotation(*updated) if updated else None,
            }
    elif action == "delete":
        located = find_annotation(document, payload["annotation_id"])
        if not located:
            result = {"found": False, "annotation": None}
        else:
            _, page, annotation = located
            page.delete_annot(annotation)
            document = save_document(document, pdf_path)
            result = {"found": True, "annotation": None}
    else:
        raise ValueError("unsupported annotation action")
    json.dump(result, OUTPUT, ensure_ascii=False)
finally:
    document.close()
`;

async function runWorker(
  absolutePdfPath: string,
  action: PdfAnnotationWorkerAction,
  payload: Record<string, unknown> = {},
): Promise<WorkerResponse> {
  const python = await getPythonCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(
      python.command,
      [...python.argsPrefix, '-c', PYTHON_PDF_ANNOTATION_SCRIPT],
      { stdio: ['pipe', 'pipe', 'pipe'], env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PDF annotation worker failed with exit code ${code}`));
        return;
      }
      try {
        const lineStart = stdout.lastIndexOf('\n{');
        const objectStart = lineStart >= 0 ? lineStart + 1 : stdout.indexOf('{');
        if (objectStart < 0) throw new Error('PDF annotation worker did not return JSON');
        resolve(JSON.parse(stdout.slice(objectStart)) as WorkerResponse);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('PDF annotation worker response is invalid'));
      }
    });
    child.stdin.end(JSON.stringify({ action, pdf_path: absolutePdfPath, ...payload }));
  });
}

export class PdfAnnotationWorker {
  async list(absolutePdfPath: string): Promise<PdfAnnotation[]> {
    const response = await runWorker(absolutePdfPath, 'list');
    return (response.annotations ?? []).map((annotation) => PdfAnnotationSchema.parse(annotation));
  }

  async create(
    absolutePdfPath: string,
    payload: CreatePdfAnnotationPayload,
  ): Promise<PdfAnnotation> {
    const response = await runWorker(absolutePdfPath, 'create', { annotation: payload });
    return PdfAnnotationSchema.parse(response.annotation);
  }

  async update(
    absolutePdfPath: string,
    payload: UpdatePdfAnnotationPayload,
  ): Promise<PdfAnnotation | null> {
    const response = await runWorker(absolutePdfPath, 'update', { annotation: payload });
    return response.found ? PdfAnnotationSchema.parse(response.annotation) : null;
  }

  async delete(absolutePdfPath: string, annotationId: string): Promise<boolean> {
    const response = await runWorker(absolutePdfPath, 'delete', { annotation_id: annotationId });
    return response.found === true;
  }
}
