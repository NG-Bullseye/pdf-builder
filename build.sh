#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/out"
THEME="${PDF_THEME:-default}"
THEME_DIR="$SCRIPT_DIR/themes/$THEME"
CSS="$THEME_DIR/style.css"
TEMPLATE="$THEME_DIR/template.html"
TMP_HTML="/tmp/pdf-builder-$(date +%s).html"

usage() {
    echo "Usage: build.sh <input.md> [--logo /path/to/logo.png]"
    echo "Theme: PDF_THEME env (default: 'default'). Resolves to themes/\$PDF_THEME/."
    exit 1
}

[[ $# -lt 1 ]] && usage

INPUT="$1"
LOGO="${LOGO:-}"
shift

while [[ $# -gt 0 ]]; do
    case "$1" in
        --logo) LOGO="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

[[ ! -f "$INPUT" ]] && { echo "File not found: $INPUT"; exit 1; }
[[ ! -d "$THEME_DIR" ]] && { echo "Theme not found: $THEME_DIR"; exit 1; }
[[ ! -f "$CSS" ]] && { echo "Theme missing style.css: $CSS"; exit 1; }
[[ ! -f "$TEMPLATE" ]] && { echo "Theme missing template.html: $TEMPLATE"; exit 1; }

# If no --logo passed, fall back to themes/<theme>/logo.{png,svg,jpg} if present.
if [[ -z "$LOGO" ]]; then
    for ext in png svg jpg jpeg; do
        candidate="$THEME_DIR/logo.$ext"
        if [[ -f "$candidate" ]]; then LOGO="$candidate"; break; fi
    done
fi

BASENAME="$(basename "$INPUT" .md)"
OUTPUT="$OUT_DIR/${BASENAME}.pdf"
mkdir -p "$OUT_DIR"

# Build logo HTML snippet (absolute file:// path required by WeasyPrint)
if [[ -n "$LOGO" && -f "$LOGO" ]]; then
    ABS_LOGO="$(cd "$(dirname "$LOGO")" && pwd)/$(basename "$LOGO")"
    LOGO_HTML='<div id="page-logo"><img src="file://'"$ABS_LOGO"'" alt="Logo"></div>'
else
    LOGO_HTML=""
fi

pandoc "$INPUT" \
    --from gfm \
    --to html5 \
    --standalone \
    --css "$CSS" \
    --template "$TEMPLATE" \
    --variable logo_html="$LOGO_HTML" \
    -o "$TMP_HTML"

weasyprint "$TMP_HTML" "$OUTPUT"

rm -f "$TMP_HTML"
echo "PDF: $OUTPUT (theme: $THEME)"
