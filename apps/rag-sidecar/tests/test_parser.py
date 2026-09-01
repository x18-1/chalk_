import json
from pathlib import Path
import sys
import types

import pytest

from chalk_rag_sidecar.parser import ParsedDocument, ParserError, _mineru_pages_from_content_list, parse_document


def test_text_parser_keeps_page_marker_for_citations() -> None:
    parsed = parse_document("notes.md", "text/markdown", "第一段\n第二段".encode())

    assert parsed.page_count == 1
    assert "[CHALK_PAGE:1]" in parsed.as_index_text()
    assert "第一段" in parsed.as_index_text()


def test_index_text_marks_paragraphs_per_page() -> None:
    parsed = ParsedDocument(("第一段\n\n第二段", "第三页"))

    indexed = parsed.as_index_text()
    assert "[CHALK_PAGE:1][CHALK_PARAGRAPH:1]" in indexed
    assert "[CHALK_PAGE:1][CHALK_PARAGRAPH:2]" in indexed
    assert "[CHALK_PAGE:2][CHALK_PARAGRAPH:1]" in indexed


def test_engine_can_be_selected_explicitly() -> None:
    parsed = parse_document("notes.md", "text/markdown", b"hello", engine="text-only")

    assert parsed.engine == "text_only"
    assert parsed.pages == ("hello",)


def test_markitdown_fails_with_actionable_message_when_optional_dependency_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "markitdown", None)
    with pytest.raises(ParserError, match="markitdown is not installed"):
        parse_document("notes.md", "text/markdown", b"hello", engine="markitdown")


def test_markitdown_adapter_returns_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResult:
        text_content = "# Converted\n\ncontent"

    class FakeConverter:
        def convert(self, path: str) -> FakeResult:
            assert Path(path).read_bytes() == b"hello"
            return FakeResult()

    monkeypatch.setitem(sys.modules, "markitdown", types.SimpleNamespace(MarkItDown=FakeConverter))
    parsed = parse_document("notes.md", "text/markdown", b"hello", engine="markitdown")

    assert parsed.engine == "markitdown"
    assert "Converted" in parsed.pages[0]


def test_mineru_fails_closed_when_local_cli_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_MINERU_MODE", "local")
    monkeypatch.setenv("RAG_MINERU_CLI_PATH", "/does/not/exist/mineru")

    with pytest.raises(ParserError, match="not executable"):
        parse_document("paper.pdf", "application/pdf", b"not-a-real-pdf", engine="mineru")


def test_mineru_content_list_preserves_pages_and_formula(tmp_path: Path) -> None:
    (tmp_path / "paper_content_list.json").write_text(
        json.dumps([
            {"type": "text", "page_idx": 0, "text": "题目一"},
            {"type": "equation", "page_idx": 0, "latex": "x^2+1"},
            {"type": "text", "page_idx": 1, "text": "题目二"},
        ]),
        encoding="utf-8",
    )

    assert _mineru_pages_from_content_list(tmp_path) == ("题目一\n\nx^2+1", "题目二")
