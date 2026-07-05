import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

function isBorderLine(line: string): boolean {
  const text = stripAnsi(line).trim();
  return text.includes("─") && /^[─ ↑↓0-9more]+$/.test(text);
}

class ChevronEditor extends CustomEditor {
  private prompt = "➜ ";
  private continuation = "  ";

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
    super(tui, theme, keybindings, { autocompleteMaxVisible: 20, ...options });
  }

  render(width: number): string[] {
    const promptWidth = visibleWidth(this.prompt);
    const base = super.render(Math.max(1, width - promptWidth));

    let sawTopBorder = false;
    let inEditorBody = false;
    let usedPrimaryPrompt = false;

    return base.map((line) => {
      if (isBorderLine(line)) {
        if (!sawTopBorder) {
          sawTopBorder = true;
          inEditorBody = true;
        } else if (inEditorBody) {
          inEditorBody = false;
        }

        // Keep borders full-width after rendering the base editor narrower.
        return line + "─".repeat(promptWidth);
      }

      if (sawTopBorder && inEditorBody) {
        const prefix = usedPrimaryPrompt ? this.continuation : this.prompt;
        usedPrimaryPrompt = true;
        return prefix + line;
      }

      // Autocomplete rows sit below the editor body; align them with the text.
      return this.continuation + line;
    });
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => new ChevronEditor(tui, theme, keybindings));
  });
}
