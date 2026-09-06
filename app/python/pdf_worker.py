import json
import sys
import time
from pathlib import Path

import pymupdf


def emit(payload):
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))


def fail(code, message, details=None):
    emit({
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details,
        },
    })


def estimated_tokens(text):
    return (len(text.encode("utf-8")) + 2) // 3


def inspect_and_extract(payload):
    pdf_path = Path(payload["pdf_path"])
    limits = payload["limits"]
    started = time.perf_counter()

    try:
        document = pymupdf.open(pdf_path)
    except Exception:
        fail("PDF_CORRUPT", "PDF 无法由 PyMuPDF 打开。")
        return

    try:
        if document.needs_pass:
            fail("PDF_ENCRYPTED", "PDF 需要密码。")
            return

        page_count = document.page_count
        if page_count <= 0:
            fail("PDF_CORRUPT", "PDF 不包含有效页面。")
            return
        if page_count > limits["max_pages"]:
            fail(
                "PDF_LIMIT_EXCEEDED",
                "PDF 页数超过限制。",
                {"limit_kind": "max_pages", "limit": limits["max_pages"], "actual": page_count},
            )
            return

        pages = []
        extracted_char_count = 0
        token_estimate = 0
        for page_index in range(page_count):
            text = document[page_index].get_text("text", sort=True)
            extracted_char_count += len(text)
            if extracted_char_count > limits["max_extracted_chars"]:
                fail(
                    "PDF_LIMIT_EXCEEDED",
                    "PDF 提取字符数超过限制。",
                    {
                        "limit_kind": "max_extracted_chars",
                        "limit": limits["max_extracted_chars"],
                        "actual": extracted_char_count,
                    },
                )
                return

            token_estimate += estimated_tokens(text)
            if token_estimate > limits["max_estimated_tokens"]:
                fail(
                    "PDF_LIMIT_EXCEEDED",
                    "PDF 估算 token 数超过限制。",
                    {
                        "limit_kind": "max_estimated_tokens",
                        "limit": limits["max_estimated_tokens"],
                        "actual": token_estimate,
                    },
                )
                return

            pages.append({
                "pdf_page_index": page_index,
                "display_page_number": page_index + 1,
                "text": text,
            })

        if not any(page["text"].strip() for page in pages):
            fail("PDF_SCANNED", "PDF 没有可提取正文。")
            return

        emit({
            "ok": True,
            "data": {
                "pymupdf_version": pymupdf.__version__,
                "page_count": page_count,
                "extracted_char_count": extracted_char_count,
                "estimated_tokens": token_estimate,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
                "pages": pages,
            },
        })
    except Exception:
        fail("PDF_CORRUPT", "PDF 页面无法稳定提取。")
    finally:
        document.close()


def main():
    try:
        payload = json.load(sys.stdin)
        if payload.get("action") != "inspect_extract":
            fail("WORKER_PROTOCOL_ERROR", "不支持的 PDF worker action。")
            return
        inspect_and_extract(payload)
    except Exception:
        fail("WORKER_PROTOCOL_ERROR", "PDF worker 请求无效。")


if __name__ == "__main__":
    main()
