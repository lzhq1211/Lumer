# 2C PDF Support / Extraction Spike

**日期**：2026-09-01  
**状态**：已冻结；2C 全部门禁通过  
**运行时**：PyMuPDF 1.28.2；macOS arm64；Python 3.11.5 项目 `.venv`  
**阈值 Source of Truth**：`app/src/lib/pdf/pdf-limits.v1.json`

## 冻结阈值

| 限制 | 冻结值 | 拒绝错误 |
|---|---:|---|
| `max_file_bytes` | 52,428,800 bytes（50 MiB） | `PDF_LIMIT_EXCEEDED` |
| `max_pages` | 500 | `PDF_LIMIT_EXCEEDED` |
| `max_extracted_chars` | 600,000 | `PDF_LIMIT_EXCEEDED` |
| `max_estimated_tokens` | 250,000 | `PDF_LIMIT_EXCEEDED` |

token 估算固定为逐页 `ceil(UTF-8 byte length / 3)` 后求和。它是支持边界的保守、确定性预算，不等同于任一 Provider 的正式 tokenizer。

## 公开 PDF 样本

样本来自本地公开上游测试仓库，只读运行，不复制进 Lumer。`worker_ms` 包含独立 Python worker 启动、打开与全文提取。

| 样本 | SHA-256 | bytes | 页 | 字符 | token 估算 | worker ms | 结果 |
|---|---|---:|---:|---:|---:|---:|---|
| `paper-qa/tests/stub_data/influence.pdf` | `c74c85edf37bc335ceb83d8b107c1a8e7a736157f6f32e63ca5095d1e575e1b2` | 8,701,622 | 31 | 48,108 | 16,106 | 238.438 | supported |
| `paper-qa/tests/stub_data/paper.pdf` | `145c91b72086b5cde6b048e4b50c7b325c7e1b8c6260e4e91fbc12fcf177eaf3` | 1,620,022 | 41 | 76,259 | 25,663 | 305.129 | supported |
| `paper-qa/tests/stub_data/pasa.pdf` | `3979809118c8636e3148d836da89dffd6716afa616f458a1111d76e2301cfc85` | 681,779 | 15 | 74,427 | 24,923 | 245.270 | supported |
| `pymupdf4llm/examples/country-capitals/national-capitals.pdf` | `a01fe27e623f39f3a7f7de5911761922eb267158685a773570c2169b9fa27ac8` | 131,687 | 6 | 17,470 | 5,833 | 87.898 | supported |

最大实测普通样本为 8.7 MB、41 页、76,259 字符、25,663 estimated tokens；冻结值分别提供约 6.0×、12.2×、7.9×、9.7× 的个人论文库余量。阈值针对“论文”而不是书籍或扫描档案。

## 受控边界与拒绝样本

边界样本由 `app/tests/fixtures/` 的 PyMuPDF 脚本生成，仅用于确定性验证，不作为真实论文分布证据。

| 样本 | 实际值 | 结果 |
|---|---:|---|
| 500 页且有文本 | 500 pages | supported，121 ms |
| 超页数 | 501 pages | `max_pages`，actual=501 |
| 超字符 | 600,076 chars | `max_extracted_chars` |
| 超 token 预算 | 250,743 estimated tokens | `max_estimated_tokens` |
| 超文件大小 | 52,428,801 bytes | `max_file_bytes`，worker 未启动 |
| 无文本图形页 | 0 extracted chars | `PDF_SCANNED` |
| AES-256 加密 | `needs_pass=true` | `PDF_ENCRYPTED` |
| `%PDF-` 后损坏内容 | 无法打开 | `PDF_CORRUPT` |

单栏与双栏受控样本均按物理页输出，双栏左右正文均被保留；同一文件重复提取的页文本与 `content_hash` 一致。

## 结论

- 普通可提取文本 PDF 满足 2C 的逐物理页稳定性要求，不触发返回 `/plan` 条件。
- 扫描、加密、损坏与四类超限均 fail closed，并只返回合同允许的安全 details。
- `content_hash` 按 `LUMER-EXTRACTED-TEXT-v1`、页索引和 UTF-8 字节长度计算；Annotation 不属于本批，正文不读取 Annotation 内容。
