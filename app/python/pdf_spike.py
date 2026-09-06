import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limits", required=True)
    parser.add_argument("pdfs", nargs="+")
    args = parser.parse_args()

    limits_document = json.loads(Path(args.limits).read_text(encoding="utf-8"))
    limits = {
        "max_file_bytes": limits_document["max_file_bytes"],
        "max_pages": limits_document["max_pages"],
        "max_extracted_chars": limits_document["max_extracted_chars"],
        "max_estimated_tokens": limits_document["max_estimated_tokens"],
    }
    worker = Path(__file__).with_name("pdf_worker.py")
    rows = []

    for raw_path in args.pdfs:
        pdf_path = Path(raw_path).resolve()
        digest = hashlib.sha256()
        with pdf_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        file_size = pdf_path.stat().st_size
        if file_size > limits["max_file_bytes"]:
            rows.append({
                "sample": pdf_path.name,
                "sha256": digest.hexdigest(),
                "file_bytes": file_size,
                "worker_ms": 0,
                "status": "PDF_LIMIT_EXCEEDED",
                "limit_kind": "max_file_bytes",
            })
            continue
        started = time.perf_counter()
        completed = subprocess.run(
            [sys.executable, str(worker)],
            input=json.dumps({
                "action": "inspect_extract",
                "pdf_path": str(pdf_path),
                "limits": limits,
            }),
            text=True,
            capture_output=True,
            check=False,
        )
        worker_ms = round((time.perf_counter() - started) * 1000, 3)
        response = json.loads(completed.stdout)
        row = {
            "sample": pdf_path.name,
            "sha256": digest.hexdigest(),
            "file_bytes": file_size,
            "worker_ms": worker_ms,
            "status": "supported" if response["ok"] else response["error"]["code"],
        }
        if response["ok"]:
            data = response["data"]
            row.update({
                "pages": data["page_count"],
                "extracted_chars": data["extracted_char_count"],
                "estimated_tokens": data["estimated_tokens"],
                "pymupdf_version": data["pymupdf_version"],
            })
        else:
            row["details"] = response["error"].get("details")
        rows.append(row)

    json.dump({"limits": limits_document, "samples": rows}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
