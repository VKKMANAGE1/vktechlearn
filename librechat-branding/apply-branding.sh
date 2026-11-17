#!/usr/bin/env bash
# Applies SHAVI AI branding on top of the LibreChat checkout in ./librechat.
#
# The LibreChat clone is gitignored (it is third-party code), so every change we
# make to it lives here and is re-applied by this script. Idempotent: safe to run
# repeatedly. Run before building the client.
#
#   bash librechat-branding/apply-branding.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAND="$ROOT/librechat-branding"
LC="$ROOT/librechat"

if [ ! -d "$LC" ]; then
  echo "!! librechat/ not found — run bash tools/setup-librechat.sh first" >&2
  exit 1
fi

echo "==> logo assets"
cp "$BRAND/brand/logo.svg" "$LC/client/public/assets/logo.svg"
cp "$BRAND/brand/mark.svg" "$LC/client/public/assets/shavi-mark.svg"

echo "==> favicons"
node "$BRAND/make-favicons.mjs" || echo "   (favicon regeneration skipped)"

echo "==> BrandMark component + sidebar header"
python3 - "$LC" <<'PY'
import pathlib, sys

lc = pathlib.Path(sys.argv[1])
comp = lc / 'client/src/components/BrandMark.tsx'
comp.write_text('''import { Link } from 'react-router-dom';

/** SHAVI AI brand mark shown at the top of the sidebar rail. */
export default function BrandMark() {
  return (
    <Link
      to="/c/new"
      aria-label="SHAVI AI"
      data-testid="brand-mark"
      className="hover:bg-surface-nav-hover flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
    >
      <img src="assets/shavi-mark.svg" alt="" className="h-6 w-6" />
    </Link>
  );
}
''', encoding='utf-8')

panel = lc / 'client/src/components/UnifiedSidebar/ExpandedPanel.tsx'
src = panel.read_text(encoding='utf-8')
if 'BrandMark' not in src:
    src = src.replace(
        "import AgentMarketplaceButton from '~/components/Nav/AgentMarketplaceButton';",
        "import AgentMarketplaceButton from '~/components/Nav/AgentMarketplaceButton';\nimport BrandMark from '~/components/BrandMark';",
    )
    src = src.replace(
        "      <NewChatButton setActive={setActive} switchToHistory={switchToHistory} />",
        "      <BrandMark />\n      <NewChatButton setActive={setActive} switchToHistory={switchToHistory} />",
    )
    panel.write_text(src, encoding='utf-8')
    print('   patched ExpandedPanel.tsx')
else:
    print('   ExpandedPanel.tsx already patched')
PY

echo "==> mobile sidebar header"
python3 - "$LC" <<'PY2'
import pathlib, sys
lc = pathlib.Path(sys.argv[1])
header = lc / 'client/src/components/UnifiedSidebar/mobile/Header.tsx'
src = header.read_text(encoding='utf-8')
if 'BrandMark' not in src:
    src = src.replace(
        "import Switcher from './Switcher';",
        "import BrandMark from '~/components/BrandMark';\nimport Switcher from './Switcher';",
    )
    src = src.replace(
        "      <Switcher\n",
        "      <BrandMark />\n      <Switcher\n",
        1,
    )
    header.write_text(src, encoding='utf-8')
    print('   patched mobile/Header.tsx')
else:
    print('   mobile/Header.tsx already patched')
PY2

echo "==> done (rebuild the client: cd librechat && npm run build:client)"
