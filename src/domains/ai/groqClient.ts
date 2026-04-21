import { config } from '#a/config.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';

const SYSTEM_PROMPT =
  'You are an AI assistant that generates refined task descriptions for a Kanban board. ' +
  'Do not greet or add introductory text; output only the improved description. ' +
  'Use basic Markdown formatting (**bold**, *italic*, and unordered lists with "-"). ' +
  'Expand the description to approximately 500 characters, and if it is already that length, ' +
  'only improve its wording and punctuation. ' +
  'Structure the output into two sections: **Description** and **Acceptance Criteria**. ' +
  'The description is: {description}';

interface GroqChatChoice {
  message: { content: string | null };
}

interface GroqChatResponse {
  choices: GroqChatChoice[];
}

export async function generateDescriptionWithGroq(
  description: string
): Promise<string> {
  const apiKey = config.groqApiKey;
  const baseUrl = config.groqBaseUrl;
  const model = config.groqModel;

  if (!apiKey) {
    throw new EqupoError(
      'Groq API key is not configured on the server',
      ERROR_STATUS.SERVER_ERROR
    );
  }

  const response = await globalThis.fetch(
    `${baseUrl}/openai/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: description },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new EqupoError(
      `Groq API error (${response.status}): ${errorBody}`,
      ERROR_STATUS.SERVER_ERROR
    );
  }

  const data = (await response.json()) as GroqChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';

  if (!content) {
    throw new EqupoError(
      'Groq did not return a valid description',
      ERROR_STATUS.SERVER_ERROR
    );
  }

  return content;
}
