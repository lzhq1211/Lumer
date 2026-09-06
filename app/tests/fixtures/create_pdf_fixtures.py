import sys
from pathlib import Path

import pymupdf


def save_text_pdf(target, columns=1, pages=2):
    document = pymupdf.open()
    for page_index in range(pages):
        page = document.new_page(width=595, height=842)
        if columns == 1:
            page.insert_textbox(
                pymupdf.Rect(50, 50, 545, 792),
                f"Physical page {page_index + 1}\nAlpha beta gamma delta.\nEvidence line.",
                fontsize=11,
            )
        else:
            page.insert_textbox(
                pymupdf.Rect(50, 50, 280, 792),
                f"Left column page {page_index + 1}.\nLeft evidence.",
                fontsize=11,
            )
            page.insert_textbox(
                pymupdf.Rect(315, 50, 545, 792),
                f"Right column page {page_index + 1}.\nRight evidence.",
                fontsize=11,
            )
    document.save(target)
    document.close()


def save_scanned_pdf(target):
    document = pymupdf.open()
    page = document.new_page()
    page.draw_rect(pymupdf.Rect(50, 50, 300, 300), color=(0, 0, 0), fill=(0.8, 0.8, 0.8))
    document.save(target)
    document.close()


def save_live_codex_pdf(target):
    document = pymupdf.open()
    page_one = document.new_page(width=595, height=842)
    page_one.insert_textbox(
        pymupdf.Rect(50, 50, 545, 792),
        "Structured Practice Study\n"
        "Sample: 42 adult participants completed a two-week structured practice program.\n"
        "Method: Accuracy was measured before and after the program using the same task.\n"
        "Result: Mean accuracy increased from 61% at baseline to 78% after structured practice.",
        fontsize=11,
    )
    page_two = document.new_page(width=595, height=842)
    page_two.insert_textbox(
        pymupdf.Rect(50, 50, 545, 792),
        "Interpretation: Structured practice was associated with higher task accuracy in this sample.\n"
        "Limitation: The study did not include a no-practice comparison group.",
        fontsize=11,
    )
    document.save(target)
    document.close()


def save_encrypted_pdf(target):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Encrypted text")
    document.save(
        target,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner-secret",
        user_pw="user-secret",
    )
    document.close()


def main():
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    save_text_pdf(output / "single-column.pdf")
    save_text_pdf(output / "two-column.pdf", columns=2)
    save_text_pdf(output / "three-pages.pdf", pages=3)
    save_live_codex_pdf(output / "live-codex.pdf")
    save_scanned_pdf(output / "scanned.pdf")
    save_encrypted_pdf(output / "encrypted.pdf")


if __name__ == "__main__":
    main()
