import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "/Users/agustin/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

// Pi's built-in `hideThinkingBlock` setting collapses thinking to a visible
// "Thinking..." placeholder. This extension patches the TUI assistant-message
// component so hidden thinking blocks render as *nothing* instead.

type AssistantMessageComponentInternals = AssistantMessageComponent & {
  contentContainer: { clear(): void; addChild(child: unknown): void };
  hideThinkingBlock: boolean;
  markdownTheme: unknown;
  lastMessage: any;
  hasToolCalls: boolean;
};

const proto = AssistantMessageComponent.prototype as AssistantMessageComponentInternals & {
  updateContent(message: any): void;
  __piHideThinkingPatched?: boolean;
  __piOriginalUpdateContent?: (message: any) => void;
};

if (!proto.__piHideThinkingPatched) {
  proto.__piHideThinkingPatched = true;
  proto.__piOriginalUpdateContent = proto.updateContent;

  proto.updateContent = function updateContentWithoutHiddenThinking(message: any) {
    const self = this as AssistantMessageComponentInternals;

    if (!self.hideThinkingBlock) {
      return proto.__piOriginalUpdateContent!.call(this, message);
    }

    self.lastMessage = message;
    self.contentContainer.clear();

    const visibleContent = message.content.filter((c: any) => c.type === "text" && c.text.trim());
    if (visibleContent.length > 0) {
      self.contentContainer.addChild(new Spacer(1));
    }

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type !== "text" || !content.text.trim()) continue;

      self.contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, self.markdownTheme as any));

      const hasVisibleTextAfter = message.content.slice(i + 1).some((c: any) => c.type === "text" && c.text.trim());
      if (hasVisibleTextAfter) {
        self.contentContainer.addChild(new Spacer(1));
      }
    }

    const hasToolCalls = message.content.some((c: any) => c.type === "toolCall");
    self.hasToolCalls = hasToolCalls;
    if (hasToolCalls) return;

    if (message.stopReason === "aborted") {
      const abortMessage =
        message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : "Operation aborted";
      self.contentContainer.addChild(new Spacer(1));
      self.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
    } else if (message.stopReason === "error") {
      const errorMsg = message.errorMessage || "Unknown error";
      self.contentContainer.addChild(new Spacer(1));
      self.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
    }
  };
}

export default function hideThinkingBlocks(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // Also blank the built-in collapsed label in case Pi changes internals and
    // the prototype patch stops applying.
    ctx.ui.setHiddenThinkingLabel("");
  });
}
