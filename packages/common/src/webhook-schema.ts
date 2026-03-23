export interface ZaloWebhookAttachment {
  type?: string;
  url?: string;
  name?: string;
}

export interface ZaloWebhookEvent {
  platform_user_id: string;
  zalo_msg_id: string;
  message_type: string;
  text?: string;
  attachments: ZaloWebhookAttachment[];
  raw: Record<string, unknown>;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function asString(input: unknown): string | null {
  return typeof input === 'string' && input.length > 0 ? input : null;
}

export function validateZaloWebhookPayload(payload: unknown): { ok: true; value: ZaloWebhookEvent } | { ok: false } {
  const root = asRecord(payload);
  if (!root) return { ok: false };

  // Zalo sends nested format: sender.id, message.msg_id, message.text, event_name
  const senderObj = asRecord(root.sender);
  const messageObj = asRecord(root.message);

  const platformUserId = asString(
    senderObj?.id ?? root.platform_user_id ?? root.user_id ?? root.from_uid
  );
  const zaloMsgId = asString(
    messageObj?.msg_id ?? root.zalo_msg_id ?? root.message_id ?? root.msg_id
  );
  const messageType = asString(
    root.event_name ?? root.message_type ?? root.event_type ?? 'message'
  );

  if (!platformUserId || !zaloMsgId || !messageType) {
    return { ok: false };
  }

  // Text: from message.text (Zalo format) or root.text (flat format)
  const textValue = messageObj?.text ?? root.text;

  // Attachments: from message.attachments (Zalo format) or root.attachments (flat format)
  const attachmentsSource = messageObj?.attachments ?? root.attachments;
  const attachmentsRaw = Array.isArray(attachmentsSource) ? attachmentsSource : [];
  const attachments = attachmentsRaw
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => {
      const attachment: ZaloWebhookAttachment = {};
      if (typeof item.type === 'string') attachment.type = item.type;
      if (typeof item.url === 'string') attachment.url = item.url;
      if (typeof item.name === 'string') attachment.name = item.name;
      // Zalo may use payload.url for image attachments
      if (!attachment.url && typeof item.payload === 'object' && item.payload !== null) {
        const payloadObj = item.payload as Record<string, unknown>;
        if (typeof payloadObj.url === 'string') attachment.url = payloadObj.url;
        if (typeof payloadObj.thumbnail === 'string' && !attachment.url) attachment.url = payloadObj.thumbnail;
      }
      return attachment;
    });

  return {
    ok: true,
    value: {
      platform_user_id: platformUserId,
      zalo_msg_id: zaloMsgId,
      message_type: messageType,
      ...(typeof textValue === 'string' ? { text: textValue } : {}),
      attachments,
      raw: root
    }
  };
}
