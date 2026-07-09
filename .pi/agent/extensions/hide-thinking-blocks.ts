import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";

type ThemeFormatter = {
  fg(color: "error", text: string): string;
};

type AssistantMessageContent = {
  type: string;
  text?: string;
};

type AssistantMessageLike = {
  content: AssistantMessageContent[];
  stopReason?: string;
  errorMessage?: string;
};

type AssistantMessageComponentInternals = AssistantMessageComponent & {
  contentContainer: { clear(): void; addChild(child: unknown): void };
  hideThinkingBlock: boolean;
  markdownTheme: unknown;
  outputPad: number;
  lastMessage: AssistantMessageLike;
  hasToolCalls: boolean;
};

type AssistantMessageComponentPrototype = AssistantMessageComponentInternals & {
  updateContent(message: AssistantMessageLike): void;
  __piHideThinkingPatched?: boolean;
  __piOriginalUpdateContent?: (message: AssistantMessageLike) => void;
};

let activeTheme: ThemeFormatter | undefined;

export default function hideThinkingBlocks(pi: ExtensionAPI) {
  patchAssistantMessageComponent();

  pi.on("session_start", (_event, ctx) => {
    activeTheme = ctx.ui.theme as ThemeFormatter;
    ctx.ui.setHiddenThinkingLabel("");
  });
}

function patchAssistantMessageComponent(): void {
  const proto = AssistantMessageComponent.prototype as AssistantMessageComponentPrototype;

  if (proto.__piHideThinkingPatched) {
    return;
  }

  proto.__piHideThinkingPatched = true;
  proto.__piOriginalUpdateContent = proto.updateContent;

  proto.updateContent = function updateContentWithoutHiddenThinking(message: AssistantMessageLike) {
    const self = this as AssistantMessageComponentInternals;

    if (!self.hideThinkingBlock) {
      return proto.__piOriginalUpdateContent!.call(this, message);
    }

    self.lastMessage = message;
    self.contentContainer.clear();

    const visibleTextContent = message.content.filter(isVisibleTextContent);
    if (visibleTextContent.length > 0) {
      self.contentContainer.addChild(new Spacer(1));
    }

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (!isVisibleTextContent(content)) {
        continue;
      }

      self.contentContainer.addChild(new Markdown(content.text.trim(), self.outputPad, 0, self.markdownTheme as any));

      const hasVisibleTextAfter = message.content.slice(i + 1).some(isVisibleTextContent);
      if (hasVisibleTextAfter) {
        self.contentContainer.addChild(new Spacer(1));
      }
    }

    self.hasToolCalls = message.content.some((content) => content.type === "toolCall");
    renderStopReason(message, self);
  };
}

function renderStopReason(message: AssistantMessageLike, self: AssistantMessageComponentInternals): void {
  if (message.stopReason === "length") {
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(
      new Text(
        formatError(
          "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
        ),
        self.outputPad,
        0,
      ),
    );
    return;
  }

  if (self.hasToolCalls) {
    return;
  }

  if (message.stopReason === "aborted") {
    const abortMessage =
      message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : "Operation aborted";
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(new Text(formatError(abortMessage), self.outputPad, 0));
  } else if (message.stopReason === "error") {
    const errorMessage = message.errorMessage || "Unknown error";
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(new Text(formatError(`Error: ${errorMessage}`), self.outputPad, 0));
  }
}

function isVisibleTextContent(
  content: AssistantMessageContent,
): content is AssistantMessageContent & { text: string } {
  return content.type === "text" && typeof content.text === "string" && content.text.trim().length > 0;
}

function formatError(message: string): string {
  return activeTheme?.fg("error", message) ?? message;
}
