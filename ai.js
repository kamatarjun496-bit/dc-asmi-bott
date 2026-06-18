
import Groq from 'groq-sdk';
import { buildSystemPrompt } from './prompt.js';
import {
  getUserMemory,
  updateUserMemory,
  getConversationHistory,
  appendToHistory,
  formatMemoryForPrompt
} from './memory.js';
 
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
 
function extractMemoryUpdate(text) {
  // Handle both <memory_update> tags and raw JSON at end of message
  const tagMatch = text.match(/<memory_update>\s*([\s\S]*?)\s*<\/memory_update>/i);
  const jsonMatch = text.match(/memory_update\s*(\{[\s\S]*?\})/i);
 
  let update = null;
  let clean = text;
 
  if (tagMatch) {
    clean = text.replace(/<memory_update>[\s\S]*?<\/memory_update>/gi, '').trim();
    try { update = JSON.parse(tagMatch[1]); } catch {}
  } else if (jsonMatch) {
    clean = text.replace(/memory_update\s*\{[\s\S]*?\}/gi, '').trim();
    try { update = JSON.parse(jsonMatch[1]); } catch {}
  }
 
  return { clean, update };
}
 
export async function getAsmiReply(userId, username, userMessage) {
  const [memory, history] = await Promise.all([
    getUserMemory(userId, username),
    getConversationHistory(userId)
  ]);
 
  const memoryText = formatMemoryForPrompt(memory);
  const systemPrompt = buildSystemPrompt(memoryText);
 
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];
 
  let response;
  try {
    response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 1024,
      messages
    });
  } catch (err) {
    const errMsg = err?.message ?? '';
    const errBody = JSON.stringify(err?.error ?? '');
 
    if (err?.status === 429 || errMsg.includes('rate_limit') || errBody.includes('rate_limit')) {
      const timeMatch = (errMsg + errBody).match(/try again in ([\d.]+[a-z]+)/i);
      const resetTime = timeMatch ? timeMatch[1] : 'a little while';
      return `okay so... I've hit my daily limit and need a little breather 😮‍💨 I'll be back in about **${resetTime}**! don't go anywhere hehe :>`;
    }
 
    console.error('Groq API error:', err);
    return "hmm something went wrong on my end... give me a second and try again? 😅";
  }
 
  const rawReply = response.choices[0]?.message?.content ?? "hmm something went wrong on my end... give me a second and try again? 😅";
 
  const { clean: reply, update } = extractMemoryUpdate(rawReply);
 
  await Promise.all([
    appendToHistory(userId, 'user', userMessage),
    appendToHistory(userId, 'assistant', reply),
    update ? updateUserMemory(userId, update) : Promise.resolve()
  ]);
 
  return reply;
}
 
