import sys
from pathlib import Path

import pymupdf


def save_many_pages(target, page_count, text):
    document = pymupdf.open()
    for page_index in range(page_count):
        page = document.new_page(width=595, height=842)
        page.insert_textbox(
            pymupdf.Rect(36, 36, 559, 806),
            f"Page {page_index + 1}\n{text}",
            fontsize=8,
        )
    document.save(target, garbage=3, deflate=True)
    document.close()


def main():
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    save_many_pages(output / "pages-at-limit.pdf", 500, "Boundary page text.")
    save_many_pages(output / "pages-over-limit.pdf", 501, "Boundary page text.")
    save_many_pages(output / "chars-over-limit.pdf", 450, "ascii " * 250)
    save_many_pages(output / "tokens-over-limit.pdf", 300, "é" * 1500)
    with (output / "bytes-over-limit.pdf").open("wb") as oversized:
        oversized.write(b"%PDF-")
        oversized.truncate(50 * 1024 * 1024 + 1)


if __name__ == "__main__":
    main()
