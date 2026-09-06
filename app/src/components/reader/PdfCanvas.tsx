'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import type { AnnotationRect, AnnotationType, PdfAnnotation } from '@/domain/annotation';
import { pageNavigationFromDisplayPageNumber } from '@/lib/pdf/page-navigation';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfCanvasProps {
  fileUrl: string;
  pageCount: number | null;
  pageNumber: number;
  zoom: number;
  onDocumentLoaded: (pageCount: number) => void;
  onLoadError: () => void;
  annotations: PdfAnnotation[];
  annotationMode: AnnotationType | null;
  annotationBusy: boolean;
  selectedAnnotationId: string | null;
  onSelection: (selection: { text: string; rects: AnnotationRect[] }) => void;
  onAnnotationSelect: (annotation: PdfAnnotation) => void;
}

export function PdfCanvas({
  fileUrl,
  pageCount,
  pageNumber,
  zoom,
  onDocumentLoaded,
  onLoadError,
  annotations,
  annotationMode,
  annotationBusy,
  selectedAnnotationId,
  onSelection,
  onAnnotationSelect,
}: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(760);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setAvailableWidth(Math.max(480, container.clientWidth - 64));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pageWidth = Math.floor(Math.min(860, availableWidth) * (zoom / 100));
  const pageAnnotations = pageCount === null
    ? []
    : annotations.filter((annotation) => (
      annotation.pdf_page_index === pageNavigationFromDisplayPageNumber(pageNumber, pageCount).pdf_page_index
    ));

  function captureSelection(): void {
    if (!annotationMode || annotationBusy) return;
    const shell = containerRef.current?.querySelector<HTMLElement>('.pdf-page-shell');
    const selection = window.getSelection();
    if (!shell || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!shell.contains(range.commonAncestorContainer)) return;
    const shellRect = shell.getBoundingClientRect();
    if (shellRect.width <= 0 || shellRect.height <= 0) return;
    const rects = [...range.getClientRects()]
      .map((rect) => ({
        x: Math.max(0, (rect.left - shellRect.left) / shellRect.width),
        y: Math.max(0, (rect.top - shellRect.top) / shellRect.height),
        width: Math.min(1, rect.width / shellRect.width),
        height: Math.min(1, rect.height / shellRect.height),
      }))
      .filter((rect) => (
        rect.width > 0.0005
        && rect.height > 0.0005
        && rect.x + rect.width <= 1.0001
        && rect.y + rect.height <= 1.0001
      ))
      .map((rect) => ({
        ...rect,
        width: Math.min(rect.width, 1 - rect.x),
        height: Math.min(rect.height, 1 - rect.y),
      }));
    const text = selection.toString().trim();
    if (text && rects.length > 0) {
      onSelection({ text, rects });
      selection.removeAllRanges();
    }
  }

  return (
    <div className="lumer-pdf-scroll" ref={containerRef}>
      <Document
        file={fileUrl}
        loading={<div className="lumer-pdf-page-skeleton" aria-label="正在解析 PDF" />}
        onLoadError={onLoadError}
        onLoadSuccess={({ numPages }) => onDocumentLoaded(numPages)}
      >
        <div className="pdf-page-shell" data-page-number={pageNumber} onMouseUp={captureSelection}>
          <Page
            pageNumber={pageNumber}
            renderAnnotationLayer={false}
            renderTextLayer
            width={pageWidth}
          />
          <div className="pdf-highlight-layer" aria-label="已保存的标注">
            {pageAnnotations.flatMap((annotation) => annotation.rects.map((rect, index) => (
              <button
                aria-label={`打开第 ${annotation.display_page_number} 页标注`}
                className={`pdf-highlight-box pdf-highlight-box--interactive pdf-highlight-box--${annotation.type}${selectedAnnotationId === annotation.annotation_id ? ' pdf-highlight-box--selected' : ''}`}
                key={`${annotation.annotation_id}-${index}`}
                onClick={() => onAnnotationSelect(annotation)}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
                type="button"
              />
            )))}
          </div>
        </div>
      </Document>
    </div>
  );
}
