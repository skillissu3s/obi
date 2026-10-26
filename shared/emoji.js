// Emoji for boards, lists and cards: a small, hand-picked set to choose from,
// and a check that what was typed or pasted really is an emoji.

/** The emoji in a string (up to a few characters, for flags and ZWJ sequences), or null */
export function cleanEmoji(s) {
  const v = [...String(s ?? '').trim()].slice(0, 8).join('')
  return v && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) && !/\p{L}/u.test(v) ? v : null
}

/** The emoji a title starts with, and the rest of it: { emoji, rest } */
export function leadingEmoji(title) {
  const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*/u.exec(String(title ?? ''))
  return m ? { emoji: m[1], rest: String(title).slice(m[0].length) } : { emoji: null, rest: String(title ?? '') }
}

export const EMOJI_GROUPS = [
  { id: 'work', name: 'Work', list: '🚀 🎯 📌 📍 ✅ ☑️ 🔥 ⭐ 💡 🧠 📈 📉 📊 🗂️ 📁 📝 ✏️ 🖊️ 📎 🔗 📅 🗓️ ⏰ ⏳ 🔔 📣 💬 🤝 👥 🏁 🏆 🎉 🧪 🔬 🛠️ 🔧 ⚙️ 🧩 🐛 🔒 🔑 💼 🏢 💰 💳 🧾 📦 🚚 🛒' },
  { id: 'faces', name: 'Faces', list: '😀 😄 😊 🙂 😉 😍 🤩 😎 🤓 🧐 🤔 😴 😅 😬 😮 😱 😤 😢 🥳 🤯 🫡 🙏 👍 👎 👏 🙌 💪 ✌️ 🤞 👀 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍' },
  { id: 'life', name: 'Life', list: '🏠 🛏️ 🍳 🛁 🧺 🧹 🌱 🪴 🐶 🐱 🏃 🚴 🧘 🏋️ ⚽ 🎮 🎨 🎵 🎬 📚 📖 🎓 ✈️ 🏖️ 🏔️ 🗺️ 🚗 🚲 ☕ 🍕 🍎 🥗 🎂 🎁 💊 🩺 🧳 💍' },
  { id: 'nature', name: 'Nature', list: '☀️ 🌙 ⭐ ⚡ 🌈 ☁️ 🌧️ ❄️ 🌊 🌸 🌻 🌲 🍀 🍁 🌍 🔥 💧 🌵 🐝 🦋 🐢 🦊 🐼 🐳' },
  { id: 'symbols', name: 'Symbols', list: '🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🔺 🔻 🔶 ➡️ ⬆️ ⬇️ 🔁 ♻️ ❗ ❓ ⚠️ 🚫 💯 🆕 🆗 🔜' },
].map((g) => ({ ...g, list: g.list.split(' ').filter(Boolean) }))
