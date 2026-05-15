const summaryModel = "@cf/meta/llama-3.1-8b-instruct-fast";

export async function buildConversationContext(env, conversationId, options = {}) {
  const limit = options.limit || 14;
  const excludeMessageId = options.excludeMessageId || null;

  if (!env.DB || !conversationId) {
    return [];
  }

  const conversation = await env.DB.prepare(
    "SELECT summary FROM conversations WHERE id = ?"
  ).bind(conversationId).first();

  const query = excludeMessageId
    ? `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = ? AND id != ?
       ORDER BY created_at DESC
       LIMIT ?`
    : `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`;

  const statement = env.DB.prepare(query);
  const result = excludeMessageId
    ? await statement.bind(conversationId, excludeMessageId, limit).all()
    : await statement.bind(conversationId, limit).all();

  const context = [];
  const summary = (conversation?.summary || "").trim();

  if (summary) {
    context.push({
      role: "system",
      content: "\u4ee5\u4e0b\u662f\u672c\u4f1a\u8bdd\u8f83\u65e9\u5185\u5bb9\u7684\u6458\u8981\uff0c\u8bf7\u4f5c\u4e3a\u4e0a\u4e0b\u6587\u53c2\u8003\uff1a\n" + summary
    });
  }

  const recentMessages = (result.results || [])
    .reverse()
    .map(message => ({
      role: message.role,
      content: message.content
    }));

  return [
    ...context,
    ...recentMessages
  ];
}

function extractTextResult(result) {
  return (
    result?.response ||
    result?.result?.response ||
    result?.output_text ||
    result?.text ||
    result?.choices?.[0]?.message?.content ||
    result?.choices?.[0]?.text ||
    ""
  ).trim();
}

function formatMessagesForSummary(messages) {
  return messages.map(message => {
    const role = message.role === "assistant" ? "Assistant" : "User";
    return role + ":\n" + (message.content || "").slice(0, 4000);
  }).join("\n\n---\n\n");
}

export async function maybeUpdateConversationSummary(env, conversationId) {
  if (!env.DB || !env.AI || !conversationId) {
    return;
  }

  try {
    const conversation = await env.DB.prepare(
      `SELECT summary, summarized_message_id, summarized_at
       FROM conversations
       WHERE id = ?`
    ).bind(conversationId).first();

    if (!conversation) {
      return;
    }

    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?"
    ).bind(conversationId).first();
    const messageCount = Number(countRow?.count || 0);

    if (messageCount < 24) {
      return;
    }

    let newMessagesSinceSummary = messageCount;

    if (conversation.summarized_message_id) {
      const summarizedMessage = await env.DB.prepare(
        "SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?"
      ).bind(conversation.summarized_message_id, conversationId).first();

      if (summarizedMessage) {
        const newerRow = await env.DB.prepare(
          `SELECT COUNT(*) AS count
           FROM messages
           WHERE conversation_id = ? AND created_at > ?`
        ).bind(conversationId, summarizedMessage.created_at).first();
        newMessagesSinceSummary = Number(newerRow?.count || 0);
      }
    }

    const hasSummary = Boolean((conversation.summary || "").trim());

    if (
      (hasSummary && (messageCount < 30 || newMessagesSinceSummary < 12)) ||
      (!hasSummary && messageCount < 24)
    ) {
      return;
    }

    const result = await env.DB.prepare(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    ).bind(conversationId, Math.max(1, messageCount - 10)).all();
    let messagesToSummarize = result.results || [];

    if (conversation.summarized_message_id) {
      const summarizedMessage = await env.DB.prepare(
        "SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?"
      ).bind(conversation.summarized_message_id, conversationId).first();

      if (summarizedMessage) {
        messagesToSummarize = messagesToSummarize.filter(
          message => message.created_at > summarizedMessage.created_at
        );
      }
    }

    if (!messagesToSummarize.length) {
      return;
    }

    const previousSummary = (conversation.summary || "").trim();
    const prompt = [
      "\u4f60\u8981\u4e3a\u4e00\u4e2a\u5355\u4e00\u4f1a\u8bdd\u66f4\u65b0\u6458\u8981\uff0c\u7528\u4e2d\u6587\u8f93\u51fa\u3002",
      "\u76ee\u6807\uff1a\u538b\u7f29\u8f83\u65e9\u804a\u5929\u5185\u5bb9\uff0c\u4f9b\u540e\u7eed\u540c\u4e00\u4f1a\u8bdd\u7ee7\u7eed\u4f7f\u7528\u3002",
      "\u5fc5\u987b\u4fdd\u7559\uff1a\u7528\u6237\u76ee\u6807\u3001\u5df2\u786e\u5b9a\u7684\u6280\u672f\u65b9\u6848\u3001\u5173\u952e\u8def\u5f84\u3001\u547d\u4ee4\u3001\u914d\u7f6e\u3001\u9519\u8bef\u4fe1\u606f\u3001\u672a\u89e3\u51b3\u95ee\u9898\u548c\u4e0b\u4e00\u6b65\u3002",
      "\u5220\u9664\uff1a\u5bd2\u6684\u3001\u91cd\u590d\u8868\u8ff0\u3001\u4e0d\u5f71\u54cd\u540e\u7eed\u5de5\u4f5c\u7684\u7ec6\u8282\u3002",
      "\u9650\u5236\uff1a\u63a7\u5236\u5728 800~1200 \u4e2d\u6587\u5b57\u4ee5\u5185\uff0c\u4e0d\u8981\u751f\u6210\u8de8\u4f1a\u8bdd\u8bb0\u5fc6\u6216\u7528\u6237\u753b\u50cf\u3002",
      previousSummary ? "\u65e7\u6458\u8981\uff1a\n" + previousSummary : "\u65e7\u6458\u8981\uff1a\uff08\u65e0\uff09",
      "\u9700\u8981\u7eb3\u5165\u6458\u8981\u7684\u8f83\u65e9\u6d88\u606f\uff1a\n" + formatMessagesForSummary(messagesToSummarize)
    ].join("\n\n");

    const aiResult = await env.AI.run(summaryModel, {
      messages: [
        {
          role: "system",
          content: "\u4f60\u662f\u4e25\u8c28\u7684\u4f1a\u8bdd\u6458\u8981\u52a9\u624b\u3002"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const summary = extractTextResult(aiResult).slice(0, 8000);

    if (!summary) {
      return;
    }

    const lastSummarized = messagesToSummarize[messagesToSummarize.length - 1];

    await env.DB.prepare(
      `UPDATE conversations
       SET summary = ?, summarized_message_id = ?, summarized_at = ?
       WHERE id = ?`
    ).bind(summary, lastSummarized.id, Date.now(), conversationId).run();
  } catch (err) {
    console.warn("conversation summary update failed", err);
  }
}
