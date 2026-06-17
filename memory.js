import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const MAX_HISTORY = 20; // Keep last 20 messages per user for context

// ─── User Memory (preferences, facts, inside jokes) ───────────────────────────

export async function getUserMemory(userId, username) {
  const { data, error } = await supabase
    .from('asmi_user_memory')
    .select('memory')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // No record yet — create one
    await supabase.from('asmi_user_memory').insert({
      user_id: userId,
      username,
      memory: {}
    });
    return {};
  }

  return data?.memory ?? {};
}

export async function updateUserMemory(userId, updates) {
  // Merge updates into existing memory
  const { data: existing } = await supabase
    .from('asmi_user_memory')
    .select('memory')
    .eq('user_id', userId)
    .single();

  const merged = { ...(existing?.memory ?? {}), ...updates };

  await supabase
    .from('asmi_user_memory')
    .update({ memory: merged })
    .eq('user_id', userId);
}

// ─── Conversation History ──────────────────────────────────────────────────────

export async function getConversationHistory(userId) {
  const { data, error } = await supabase
    .from('asmi_conversation_history')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY);

  if (error) return [];
  return data ?? [];
}

export async function appendToHistory(userId, role, content) {
  await supabase.from('asmi_conversation_history').insert({
    user_id: userId,
    role,
    content
  });

  // Trim to keep only the last MAX_HISTORY messages
  const { data: rows } = await supabase
    .from('asmi_conversation_history')
    .select('id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (rows && rows.length > MAX_HISTORY) {
    const toDelete = rows.slice(MAX_HISTORY).map(r => r.id);
    await supabase
      .from('asmi_conversation_history')
      .delete()
      .in('id', toDelete);
  }
}

export async function clearHistory(userId) {
  await supabase
    .from('asmi_conversation_history')
    .delete()
    .eq('user_id', userId);
}

// ─── Memory formatting for system prompt ──────────────────────────────────────

export function formatMemoryForPrompt(memory) {
  if (!memory || Object.keys(memory).length === 0) {
    return 'No stored memory about this user yet.';
  }

  const lines = [];
  if (memory.name) lines.push(`- Prefers to be called: ${memory.name}`);
  if (memory.games?.length) lines.push(`- Favourite games: ${memory.games.join(', ')}`);
  if (memory.hobbies?.length) lines.push(`- Hobbies: ${memory.hobbies.join(', ')}`);
  if (memory.foods?.length) lines.push(`- Favourite foods: ${memory.foods.join(', ')}`);
  if (memory.birthday) lines.push(`- Birthday: ${memory.birthday}`);
  if (memory.projects?.length) lines.push(`- Ongoing projects: ${memory.projects.join(', ')}`);
  if (memory.pets?.length) lines.push(`- Pets: ${memory.pets.join(', ')}`);
  if (memory.inside_jokes?.length) lines.push(`- Inside jokes: ${memory.inside_jokes.join(' | ')}`);
  if (memory.dislikes?.length) lines.push(`- Dislikes: ${memory.dislikes.join(', ')}`);
  if (memory.goals?.length) lines.push(`- Goals: ${memory.goals.join(', ')}`);
  if (memory.notes) lines.push(`- Extra notes: ${memory.notes}`);

  return lines.length > 0
    ? lines.join('\n')
    : 'No specific preferences stored yet.';
}
