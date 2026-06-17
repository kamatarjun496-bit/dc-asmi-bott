
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
  const match = text.match(/<memory_update>\s*([\s\S]*?)\s*<\/memory_update>/);
  if (!match) return { clean: text, update: null };
 
  const clean = text.replace(/<memory_update>[\s\S]*?<\/memory_update>/g, '').trim();
  try {
    const update = JSON.parse(match[1]);
    return { clean, update };
  } catch {
    return { clean, update: null };
  }
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
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages
    });
  } catch (err) {
    const errMsg = err?.message ?? '';
    const errBody = JSON.stringify(err?.error ?? '');
 
    if (err?.status === 429 || errMsg.includes('rate_limit') || errBody.includes('rate_limit')) {
      // Extract reset time from error message if available
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
