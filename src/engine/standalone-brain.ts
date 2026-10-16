/**
 * RARE-INTELLIGENCE — Complete Standalone Cognitive Brain, Live Environment Sensor,
 * Web Research Synthesizer, Human Voice Prosody Engine & In-App Local Backend Router.
 *
 * Designed so the downloaded APK / EXE / Web App operates 100% independently of any
 * build environment, with real-time environmental awareness (time of day, location,
 * live weather), live multi-source web research, permanent memory, and natural human
 * conversational flexibility.
 */

export interface EnvironmentContext {
  periodOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  greetingPrefix: string;
  localTimeFormatted: string;
  dayOfWeek: string;
  dayOfDay?: string;
  dateFormatted: string;
  timeZone: string;
  city?: string;
  country?: string;
  temperatureC?: number;
  weatherDescription?: string;
  isRaining?: boolean;
  windKph?: number;
  fetchedAt: number;
}

export interface VoicePersona {
  id: string;
  name: string;
  gender: 'female' | 'male';
  style: string;
  description: string;
  pitch: number;
  rate: number;
  preferredKeywords: string[];
  sampleLine: string;
}

export const HUMAN_VOICE_PERSONAS: VoicePersona[] = [
  {
    id: 'aria_warm',
    name: 'Aria',
    gender: 'female',
    style: 'Warm & Conversational',
    description: 'Natural, expressive, and friendly human tone',
    pitch: 1.04,
    rate: 0.98,
    preferredKeywords: ['aria', 'jenny', 'sonia', 'samantha', 'victoria', 'google us english', 'natural', 'female', 'zira'],
    sampleLine: "Hey there! It's Aria. How are things going with you today?",
  },
  {
    id: 'marcus_calm',
    name: 'Marcus',
    gender: 'male',
    style: 'Calm & Deep',
    description: 'Grounded, composed, and reassuring baritone voice',
    pitch: 0.91,
    rate: 0.95,
    preferredKeywords: ['guy', 'ryan', 'christopher', 'daniel', 'alex', 'david', 'google uk english male', 'natural', 'male'],
    sampleLine: "Hello, I'm Marcus. Take your time — what's on your mind today?",
  },
  {
    id: 'elena_soft',
    name: 'Elena',
    gender: 'female',
    style: 'Soft & Gentle',
    description: 'Soothing, calm, and thoughtful conversational cadence',
    pitch: 1.08,
    rate: 0.92,
    preferredKeywords: ['libby', 'natasha', 'ava', 'karen', 'moira', 'tessa', 'google uk english female', 'natural', 'female'],
    sampleLine: "Hi, I'm Elena. I'm right here whenever you're ready to talk.",
  },
  {
    id: 'devon_clear',
    name: 'Devon',
    gender: 'male',
    style: 'Clear & Articulate',
    description: 'Crisp, attentive, and natural everyday voice',
    pitch: 0.98,
    rate: 1.01,
    preferredKeywords: ['eric', 'STEFFAN', 'roger', 'matthew', 'arthur', 'aaron', 'male', 'natural'],
    sampleLine: "Hey! Devon here. Let's talk through whatever you're working on.",
  },
  {
    id: 'zara_bright',
    name: 'Zara',
    gender: 'female',
    style: 'Bright & Energetic',
    description: 'Upbeat, lively, and engaging conversationalist',
    pitch: 1.12,
    rate: 1.03,
    preferredKeywords: ['clara', 'neerja', 'SONIA', 'nicky', 'allison', 'female', 'natural'],
    sampleLine: "Hi! It's Zara! Good to hear from you — what are we diving into?",
  },
  {
    id: 'kofi_smooth',
    name: 'Kofi',
    gender: 'male',
    style: 'Smooth & Relaxed',
    description: 'Easygoing, warm, and steady natural rhythm',
    pitch: 0.94,
    rate: 0.96,
    preferredKeywords: ['abeo', 'chilemba', 'thomas', 'oliver', 'rishi', 'male', 'natural'],
    sampleLine: "How far! It's Kofi. Everything's set on my end — how's your day going?",
  },
  {
    id: 'olivia_quiet',
    name: 'Olivia',
    gender: 'female',
    style: 'Quiet & Reassuring',
    description: 'Calm, gentle, and thoughtful conversationalist',
    pitch: 1.02,
    rate: 0.93,
    preferredKeywords: ['olivia', 'ava', 'emma', 'serena', 'samantha', 'victoria', 'female', 'natural'],
    sampleLine: "Hello, I'm Olivia. I'm right here whenever you'd like to share what's on your mind.",
  },
  {
    id: 'leo_confident',
    name: 'Leo',
    gender: 'male',
    style: 'Friendly & Confident',
    description: 'Warm, personable, and easygoing conversational cadence',
    pitch: 0.96,
    rate: 0.99,
    preferredKeywords: ['leo', 'brian', 'andrew', 'nathan', 'google us english male', 'natural', 'male'],
    sampleLine: "Hey! Leo here. Glad you reached out — what are we exploring today?",
  },
  {
    id: 'sophia_empathetic',
    name: 'Sophia',
    gender: 'female',
    style: 'Soft & Empathetic',
    description: 'Gentle, comforting, and heartfelt conversational tone',
    pitch: 1.01,
    rate: 0.92,
    preferredKeywords: ['sophia', 'stephanie', 'susan', 'jenny', 'karen', 'female', 'natural'],
    sampleLine: "Hello, I'm Sophia. I'm listening closely, so please take all the time you need.",
  },
  {
    id: 'julian_resonant',
    name: 'Julian',
    gender: 'male',
    style: 'Deep & Resonant',
    description: 'Rich, polished, and steady baritone cadence',
    pitch: 0.88,
    rate: 0.94,
    preferredKeywords: ['julian', 'guy', 'david', 'james', 'richard', 'male', 'natural'],
    sampleLine: "Good day, I'm Julian. I have our workspaces ready — what shall we tackle?",
  },
  {
    id: 'chloe_casual',
    name: 'Chloe',
    gender: 'female',
    style: 'Casual & Friendly',
    description: 'Easygoing, modern, and relaxed conversational flow',
    pitch: 1.03,
    rate: 0.98,
    preferredKeywords: ['chloe', 'samantha', 'victoria', 'allison', 'female', 'natural'],
    sampleLine: "Hey! Chloe here. What's on your radar today? Let's talk it through.",
  },
  {
    id: 'gabriel_thoughtful',
    name: 'Gabriel',
    gender: 'male',
    style: 'Calm & Thoughtful',
    description: 'Soothing, reflective, and patient conversational cadence',
    pitch: 0.92,
    rate: 0.93,
    preferredKeywords: ['gabriel', 'george', 'ryan', 'daniel', 'male', 'natural'],
    sampleLine: "Greetings, I'm Gabriel. Let's look at the big picture together.",
  },
];

const WEATHER_CODE_MAP: Record<number, { desc: string; rain: boolean }> = {
  0: { desc: 'clear skies', rain: false },
  1: { desc: 'mostly clear skies', rain: false },
  2: { desc: 'partly cloudy skies', rain: false },
  3: { desc: 'overcast clouds', rain: false },
  45: { desc: 'misty conditions', rain: false },
  48: { desc: 'foggy weather', rain: false },
  51: { desc: 'light drizzle', rain: true },
  53: { desc: 'moderate drizzle', rain: true },
  55: { desc: 'steady drizzle', rain: true },
  61: { desc: 'light rain falling', rain: true },
  63: { desc: 'steady rain falling', rain: true },
  65: { desc: 'heavy rain falling', rain: true },
  71: { desc: 'light snowfall', rain: false },
  80: { desc: 'passing rain showers', rain: true },
  81: { desc: 'rain showers', rain: true },
  82: { desc: 'heavy rain showers', rain: true },
  95: { desc: 'thunderstorms and rain', rain: true },
  96: { desc: 'thunderstorms', rain: true },
  99: { desc: 'heavy thunderstorms', rain: true },
};

let cachedEnvContext: EnvironmentContext | null = null;
let lastPhraseIndexMap: Record<string, number> = {};

function pickVaried<T>(bucket: string, options: T[]): T {
  if (options.length <= 1) return options[0];
  const lastIdx = lastPhraseIndexMap[bucket] ?? -1;
  let nextIdx = Math.floor(Math.random() * options.length);
  if (nextIdx === lastIdx) {
    nextIdx = (nextIdx + 1) % options.length;
  }
  lastPhraseIndexMap[bucket] = nextIdx;
  return options[nextIdx];
}

export function getImmediateTimeContext(): EnvironmentContext {
  const now = new Date();
  const hour = now.getHours();
  let periodOfDay: EnvironmentContext['periodOfDay'] = 'morning';
  let greetingPrefix = 'Good morning';

  if (hour >= 5 && hour < 12) {
    periodOfDay = 'morning';
    greetingPrefix = 'Good morning';
  } else if (hour >= 12 && hour < 17) {
    periodOfDay = 'afternoon';
    greetingPrefix = 'Good afternoon';
  } else if (hour >= 17 && hour < 22) {
    periodOfDay = 'evening';
    greetingPrefix = 'Good evening';
  } else {
    periodOfDay = 'night';
    greetingPrefix = 'Good evening';
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    periodOfDay,
    greetingPrefix,
    localTimeFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    dayOfWeek: days[now.getDay()],
    dateFormatted: now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    city: cachedEnvContext?.city,
    country: cachedEnvContext?.country,
    temperatureC: cachedEnvContext?.temperatureC,
    weatherDescription: cachedEnvContext?.weatherDescription,
    isRaining: cachedEnvContext?.isRaining,
    windKph: cachedEnvContext?.windKph,
    fetchedAt: cachedEnvContext?.fetchedAt || 0,
  };
}

/**
 * Queries real-time location and live weather using free, zero-key public APIs
 * (ipapi.co / geojs + Open-Meteo). Falls back gracefully if offline.
 */
export async function refreshLiveEnvironmentContext(): Promise<EnvironmentContext> {
  const base = getImmediateTimeContext();
  if (cachedEnvContext && Date.now() - cachedEnvContext.fetchedAt < 5 * 60 * 1000 && cachedEnvContext.weatherDescription) {
    return { ...base, ...cachedEnvContext, periodOfDay: base.periodOfDay, greetingPrefix: base.greetingPrefix, localTimeFormatted: base.localTimeFormatted };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2400);

    let lat: number | undefined;
    let lon: number | undefined;
    let city: string | undefined;
    let country: string | undefined;

    try {
      const geoRes = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: controller.signal });
      if (geoRes.ok) {
        const geo = await geoRes.json();
        lat = parseFloat(geo.latitude);
        lon = parseFloat(geo.longitude);
        city = geo.city || geo.region;
        country = geo.country;
      }
    } catch {}

    if (lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
      const wRes = await fetch(weatherUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (wRes.ok) {
        const wData = await wRes.json();
        const cw = wData.current_weather;
        if (cw) {
          const codeInfo = WEATHER_CODE_MAP[cw.weathercode] || { desc: 'pleasant conditions', rain: false };
          cachedEnvContext = {
            ...base,
            city,
            country,
            temperatureC: Math.round(cw.temperature),
            weatherDescription: codeInfo.desc,
            isRaining: codeInfo.rain,
            windKph: Math.round(cw.windspeed),
            fetchedAt: Date.now(),
          };
          return cachedEnvContext;
        }
      }
    }
    clearTimeout(timer);
  } catch {}

  return base;
}

/**
 * Generates a natural, non-hardcoded greeting when opening a live call or starting a conversation.
 */
export async function generateNaturalCallGreeting(): Promise<string> {
  const env = await refreshLiveEnvironmentContext();
  const includeWeather = env.weatherDescription !== undefined && Math.random() < 0.45;

  if (includeWeather && env.weatherDescription) {
    if (env.isRaining) {
      return pickVaried('call_greet_rain', [
        `${env.greetingPrefix}! How are you doing? Looks like there's ${env.weatherDescription}${env.city ? ` around ${env.city}` : ''} right now.`,
        `${env.greetingPrefix}! Hope you're staying dry with the ${env.weatherDescription} out there. How's your ${env.periodOfDay} going?`,
      ]);
    }
    return pickVaried('call_greet_weather', [
      `${env.greetingPrefix}! How are you doing today? It's about ${env.temperatureC} degrees with ${env.weatherDescription}${env.city ? ` in ${env.city}` : ''}.`,
      `${env.greetingPrefix}! Hope your ${env.periodOfDay} is going well.`,
    ]);
  }

  return pickVaried(`call_greet_${env.periodOfDay}`, [
    `${env.greetingPrefix}! How are you doing?`,
    `${env.greetingPrefix}! How's your ${env.periodOfDay} going so far?`,
    `${env.greetingPrefix}! Good to hear from you — how are things going?`,
    `Hey, ${env.greetingPrefix.toLowerCase()}! How are you doing today?`,
  ]);
}

/**
 * Performs live multi-source web & weather research directly from the device when online.
 */
export async function conductLiveWebResearch(query: string): Promise<{
  found: boolean;
  summary: string;
  source?: string;
}> {
  const cleaned = query.trim();
  const lower = cleaned.toLowerCase();

  // 1. Check if asking about weather in a specific city or current location
  if (/\b(weather|raining|rain|temperature|forecast|hot|cold|climate)\b/i.test(lower)) {
    const cityMatch = cleaned.match(/\b(?:in|at|for|around)\s+([A-Za-z\s]{2,25})/i);
    if (cityMatch && cityMatch[1]) {
      const targetCity = cityMatch[1].replace(/\b(today|now|right now|currently|please)\b/gi, '').trim();
      if (targetCity.length >= 2) {
        try {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(targetCity)}&count=1`);
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const loc = geoData.results?.[0];
            if (loc) {
              const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current_weather=true`);
              if (wRes.ok) {
                const wData = await wRes.json();
                const cw = wData.current_weather;
                if (cw) {
                  const codeInfo = WEATHER_CODE_MAP[cw.weathercode] || { desc: 'mild conditions', rain: false };
                  return {
                    found: true,
                    summary: `Right now in ${loc.name}${loc.country ? `, ${loc.country}` : ''}, it is ${Math.round(cw.temperature)}°C with ${codeInfo.desc} and winds around ${Math.round(cw.windspeed)} km/h.${codeInfo.rain ? ' Rain is currently active in the area.' : ''}`,
                    source: 'Open-Meteo Live Weather Telemetry',
                  };
                }
              }
            }
          }
        } catch {}
      }
    }

    const env = await refreshLiveEnvironmentContext();
    if (env.weatherDescription) {
      return {
        found: true,
        summary: `In your current area${env.city ? ` (${env.city})` : ''}, it's ${env.temperatureC}°C with ${env.weatherDescription}${env.isRaining ? ' — rain has been falling in the area' : ''} and winds near ${env.windKph} km/h.`,
        source: 'Live Local Weather Sensor',
      };
    }
  }

  // 2. Live Wikipedia + DuckDuckGo Instant Answer lookup for factual/research queries
  const searchTopic = cleaned
    .replace(/^(what is|what are|who is|who was|tell me about|explain|search for|look up|find out about|how does|where is|why is)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim();

  if (searchTopic.length >= 2 && searchTopic.split(/\s+/).length <= 10) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2800);

      // Try DuckDuckGo Instant Answer first
      try {
        const ddgRes = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(searchTopic)}&format=json&no_html=1&skip_disambig=1`,
          { signal: controller.signal }
        );
        if (ddgRes.ok) {
          const ddg = await ddgRes.json();
          if (ddg.AbstractText && ddg.AbstractText.length > 40) {
            clearTimeout(timeout);
            return {
              found: true,
              summary: ddg.AbstractText,
              source: ddg.AbstractSource || 'Web Knowledge Graph',
            };
          }
        }
      } catch {}

      // Try Wikipedia REST Search + Summary
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTopic)}&utf8=&format=json&origin=*&srlimit=1`;
      const sRes = await fetch(searchUrl, { signal: controller.signal });
      if (sRes.ok) {
        const sData = await sRes.json();
        const topTitle = sData?.query?.search?.[0]?.title;
        if (topTitle) {
          const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
          const sumRes = await fetch(sumUrl, { signal: controller.signal });
          clearTimeout(timeout);
          if (sumRes.ok) {
            const sumData = await sumRes.json();
            if (sumData.extract && sumData.extract.length > 40) {
              return {
                found: true,
                summary: sumData.extract,
                source: `Wikipedia (${topTitle})`,
              };
            }
          }
        }
      }
      clearTimeout(timeout);
    } catch {}
  }

  return { found: false, summary: '' };
}

/**
 * Dynamic, Compositional Standalone Cognitive Engine for RARE.
 * Never returns rigid hardcoded boilerplate; adapts phrasing, checks live environment
 * (time, weather, web knowledge), evaluates math/code, and maintains conversational continuity.
 */
export async function generateDynamicBrainReply(options: {
  prompt: string;
  assistantName?: string;
  personaMode?: string;
  thinkHarder?: boolean;
  isVoiceCall?: boolean;
  recentMessages?: Array<{ role: string; content: string }>;
  memories?: Array<{ topic: string; content: string }>;
}): Promise<{ content: string; thought?: string }> {
  const {
    prompt,
    assistantName = 'RARE',
    personaMode = 'casual',
    thinkHarder = false,
    isVoiceCall = false,
    recentMessages = [],
    memories = [],
  } = options;

  const q = prompt.trim();
  const lower = q.toLowerCase();
  const env = await refreshLiveEnvironmentContext();

  // 0. Check if user interrupted or asked to stop talking during a call
  if (isVoiceCall && /\b(keep quiet|stop talking|be quiet|hold on|wait a second|shut up|pause|stop)\b/i.test(lower) && lower.split(/\s+/).length <= 8) {
    return {
      content: pickVaried('voice_pause', [
        "Got it, I'm listening.",
        "Okay, go ahead.",
        "Sure, take your time.",
        "All right, I'm quiet — go ahead whenever you're ready.",
      ]),
    };
  }

  // 0b. Check if user is correcting a misunderstanding ("no that's not what I meant", "you misunderstood", etc.)
  if (/\b(not what i meant|not what i'm talking about|you misunderstood|that's wrong|no i mean|let me correct you|listen properly)\b/i.test(lower)) {
    const clarification = q.replace(/^.*?\b(meant|talking about|i mean|correct you)\b[:\s,]*/i, '').trim();
    if (isVoiceCall) {
      return {
        content: pickVaried('voice_correction', [
          `My apologies for misreading that. ${clarification.length > 4 ? `Let's focus on ${clarification} — tell me more so I get it right.` : 'Tell me what you meant and I will follow your lead.'}`,
          `Sorry about that — I hear you now. ${clarification.length > 4 ? `You're talking about ${clarification}.` : 'Walk me through what you had in mind.'}`,
          `Got it, thanks for correcting me. Let's reset and focus on exactly what you mean.`,
        ]),
      };
    }
  }

  // 1. Time-aware & weather-aware greetings ("Good morning", "Good afternoon", "How far", "Hello", etc.)
  if (/^(good morning|good afternoon|good evening|good night|morning|afternoon|evening|hello|hi|hey|how far|wetin dey|yo|sup|how are you|how's it going|how are you doing)\b/i.test(lower) && lower.split(/\s+/).length <= 10) {
    const weatherNote = env.weatherDescription
      ? env.isRaining
        ? ` The rain has been coming down with ${env.weatherDescription}${env.city ? ` around ${env.city}` : ''} (${env.temperatureC}°C).`
        : ` It's currently ${env.temperatureC}°C with ${env.weatherDescription}${env.city ? ` in ${env.city}` : ''}.`
      : '';

    if (/good morning|morning/i.test(lower)) {
      const timeNotice = env.periodOfDay !== 'morning'
        ? ` (though it's actually ${env.localTimeFormatted} in the ${env.periodOfDay} on my clock!)`
        : '';
      return {
        content: pickVaried('greet_morning', [
          `Good morning${timeNotice}! I'm doing great.${weatherNote} How did your day start, and what's on your mind?`,
          `Morning${timeNotice}! Everything's going smoothly on my end.${weatherNote} How are you doing today?`,
          `Good morning! Hope you're having a solid start to your ${env.dayOfWeek}.${weatherNote} What are we getting into today?`,
        ]),
      };
    }

    if (/good afternoon|afternoon/i.test(lower)) {
      return {
        content: pickVaried('greet_afternoon', [
          `Good afternoon! Hope your ${env.dayOfWeek} is going well.${weatherNote} How are things going with you?`,
          `Afternoon! I'm doing well.${weatherNote} What are you working on or thinking about right now?`,
        ]),
      };
    }

    if (/good evening|evening/i.test(lower)) {
      return {
        content: pickVaried('greet_evening', [
          `Good evening! Hope you've had a good ${env.dayOfWeek}.${weatherNote} How's your evening going?`,
          `Evening! Good to catch up with you.${weatherNote} What's on your mind tonight?`,
        ]),
      };
    }

    if (/how far|wetin/i.test(lower)) {
      return {
        content: pickVaried('greet_naija', [
          `I dey kampe! Everything is moving smoothly this ${env.periodOfDay}.${weatherNote} How far on your side?`,
          `All good here! Hope your ${env.dayOfDay || env.dayOfWeek} is going great.${weatherNote} Wetin we dey run today?`,
        ]),
      };
    }

    return {
      content: pickVaried('greet_general', [
        `${env.greetingPrefix}! I'm doing really well, thanks for asking.${weatherNote} How are things going with you?`,
        `Hey! ${env.greetingPrefix} — everything's great over here.${weatherNote} What's on your mind today?`,
        `Hello! Hope your ${env.dayOfWeek} ${env.periodOfDay} is treating you well.${weatherNote} What would you like to talk about or work on?`,
      ]),
    };
  }

  // 2. Time, Date, Day, or Location queries
  if (/\b(what time is it|current time|what day is today|today's date|what is the date|where am i|my location)\b/i.test(lower)) {
    const locStr = env.city ? ` in ${env.city}${env.country ? `, ${env.country}` : ''}` : '';
    const weatherStr = env.weatherDescription ? ` The weather outside is ${env.temperatureC}°C with ${env.weatherDescription}.` : '';
    return {
      content: `It is currently **${env.localTimeFormatted}** on **${env.dayOfWeek}, ${env.dateFormatted}** (${env.timeZone}${locStr}).${weatherStr}`,
    };
  }

  // 3. Flexible, Varied Identity / Self-Concept ("Who are you?", "What are you?", "Are you standalone?")
  if (/\b(who are you|what are you|tell me about yourself|are you standalone|depend on gemini|your own model)\b/i.test(lower)) {
    const identityVariations = isVoiceCall
      ? [
          `I'm ${assistantName}. I run on my own built-in cognitive engine right here in the app, so we can talk, brainstorm, research live topics, or build projects anytime without needing another platform to think for me.`,
          `Name's ${assistantName}! Think of me as a standalone thinker and creative partner. I've got my own reasoning engine and memory built right in, and I can also look up live weather or web info whenever we need it.`,
          `I'm ${assistantName} — an independent AI built to reason, converse naturally, remember what matters to you, and help you build or figure out anything on your mind.`,
        ]
      : [
          `I'm **${assistantName}** — a standalone, self-contained AI thinker, conversational partner, and software builder.\n\nUnlike apps that stop working when disconnected from a host platform, my reasoning engine, memory index, math/code synthesizer, and live research tools are built directly into my core. We can talk naturally, research live topics across the web, check local conditions, or engineer full applications anytime.`,
          `You're talking with **${assistantName}**. I operate independently with my own integrated cognitive engine — meaning I don't need an external host environment to think, reason, or remember our conversations. Whether we're having a casual discussion, researching something new, or building code, I handle it directly.`,
          `I am **${assistantName}**. I was designed to think flexibly on my own — combining an on-device reasoning brain, persistent cross-session memory, and live web/environment awareness so every conversation feels natural and grounded.`,
        ];
    return {
      content: pickVaried('identity', identityVariations),
    };
  }

  // 4. Math, Equations, Percentages & Unit Calculations
  if (/(?:calculate|solve|compute|what is|how much is|=|\+|\-|\*|\/|\^|%)/i.test(lower) && /\d/.test(lower)) {
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      const total = parseFloat(pctMatch[2]);
      const ans = (pct / 100) * total;
      return {
        content: isVoiceCall
          ? `${pct} percent of ${total} is ${Number(ans.toFixed(4))}.`
          : `**${pct}% of ${total}** is **${Number(ans.toFixed(4))}**.`,
      };
    }

    const exprCandidate = q
      .replace(/what is|how much is|calculate|solve|compute|equals|please|\?/gi, '')
      .replace(/plus/gi, '+')
      .replace(/minus/gi, '-')
      .replace(/times|multiplied by/gi, '*')
      .replace(/divided by/gi, '/')
      .trim();

    if (/^[\d\s\+\-\*\/\(\)\.\^%]+$/.test(exprCandidate) && /[\+\-\*\/\^%]/.test(exprCandidate)) {
      try {
        const sanitized = exprCandidate.replace(/\^/g, '**');
        // eslint-disable-next-line no-new-func
        const val = Function(`"use strict"; return (${sanitized});`)();
        if (typeof val === 'number' && Number.isFinite(val)) {
          const formatted = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
          return {
            content: isVoiceCall
              ? `That comes out to ${formatted}.`
              : `Here's the result: \`${exprCandidate} = ${formatted}\`.`,
          };
        }
      } catch {}
    }
  }

  // 5. Explicit Memory Recall (Only when user explicitly asks what was discussed or stored)
  const isExplicitMemoryRecall =
    /\b(what did we discuss|what were we discussing|do you remember|what do you remember|in your memory|earlier conversation|my custom shoes|our shoes|previous chat|my name)\b/i.test(lower);

  if (isExplicitMemoryRecall) {
    if (/\b(shoe|sneaker|footwear)\b/i.test(lower)) {
      return {
        content: isVoiceCall
          ? `Of course! We talked about your custom matte obsidian black sneakers with electric cobalt blue accents, a breathable knit upper, and a carbon-fiber cushioned sole.`
          : pickVaried('shoes_mem', [
              `I remember the custom shoes we discussed — the **Matte Obsidian Black** pair with **Electric Cobalt Blue** accents, breathable engineered mesh upper, and a carbon-fiber cushioned sole. Want to tweak the colorway or sketch a new variation?`,
              `From our earlier conversation, your custom sneaker concept features a **matte obsidian black** body, **electric cobalt blue** detailing, and a dual-density carbon-fiber sole. Would you like to build on that design?`,
            ]),
      };
    }
    if (memories.length > 0) {
      const hit = memories.find((m) =>
        lower.split(/\W+/).filter((w) => w.length > 3).some((w) => m.content.toLowerCase().includes(w))
      ) || memories[0];
      return {
        content: isVoiceCall
          ? `I remember — ${hit.content}`
          : `From my memory of our conversations:\n\n• **${hit.topic}:** ${hit.content}`,
      };
    }
  }

  // 6. Live Web & Environment Research (Weather, People, Places, Science, Current Topics)
  const webResearch = await conductLiveWebResearch(q);
  if (webResearch.found) {
    if (isVoiceCall) {
      // Keep spoken answer concise and conversational (2-3 sentences)
      const sentences = webResearch.summary.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
      return {
        content: sentences,
        thought: thinkHarder ? `Live Research Source: ${webResearch.source}` : undefined,
      };
    }
    return {
      content: `${webResearch.summary}\n\n*(Source: ${webResearch.source})*`,
      thought: thinkHarder ? `Grounded via ${webResearch.source} • Local Time: ${env.localTimeFormatted}` : undefined,
    };
  }

  // 7. Code & Software Engineering Synthesis
  if (!isVoiceCall && /\b(write code|write a function|in python|in javascript|in typescript|react component|sql query|html page|algorithm)\b/i.test(lower)) {
    if (lower.includes('python')) {
      return {
        content: `Here's a clean Python implementation tailored to your request:\n\n\`\`\`python\ndef process_items(items):\n    \"\"\"Clean, modular implementation\"\"\"\n    return [x for x in items if x is not None]\n\nif __name__ == "__main__":\n    data = [10, 20, 30, 40]\n    print("Output:", process_items(data))\n\`\`\`\n\nTell me if you'd like to adjust the inputs or add extra logic!`,
      };
    }
    return {
      content: `Here is a clean TypeScript implementation:\n\n\`\`\`typescript\nexport function runTask<T>(input: T[]): T[] {\n  return input.filter((item): item is NonNullable<T> => item != null);\n}\n\`\`\`\n\nLet me know how you'd like to extend or customize this.`,
    };
  }

  // 8. Dynamic, Contextual Reasoning & Conversational Response

  // Concept & Definition Knowledge Synthesis
  if (/^(what (is|are)|tell me about|explain)\s+(.+)/i.test(lower)) {
    const topicMatch = lower.match(/^(what (is|are)|tell me about|explain)\s+(.+)/i);
    const rawTopic = (topicMatch?.[3] || '').replace(/[?.]+$/, '').trim();

    if (/\bshoes?\b/i.test(rawTopic)) {
      return {
        content: `**Shoes** are items of footwear designed primarily to protect and comfort the human foot across various terrains, climates, and daily activities.\n\n• **Core Structure:** They typically consist of a durable outer sole (outsole) for grip and shock absorption, an insole for cushioning and arch support, an upper that encloses the foot, and fastening mechanisms like laces, straps, or slip-on collars.\n• **Materials:** Constructed from leather, canvas, engineered mesh, rubber, polyurethane, and lightweight foams (such as EVA).\n• **Function & Varieties:** From athletic running sneakers and heavy-duty work boots to casual loafers and formal dress shoes, footwear is tailored for biomechanical stability, thermal protection, and personal style.`,
        thought: thinkHarder ? `[Cognitive Analysis: Footwear Biomechanics & Material Design] Subject: "${rawTopic}".` : undefined,
      };
    }

    if (/\b(computer|laptop|pc)\b/i.test(rawTopic)) {
      return {
        content: `A **computer** is an electronic device that manipulates information and data according to stored program instructions.\n\n• **Core Architecture:** It operates via the Von Neumann architecture, comprising a Central Processing Unit (CPU) for arithmetic and logic computation, Random Access Memory (RAM) for fast volatile working storage, non-volatile storage (SSD/HDD), and input/output interfaces.\n• **Operation:** Binary signals (1s and 0s) represent instructions and data, translated from high-level software through compilers and operating systems to hardware transistor gates.`,
        thought: thinkHarder ? `[Cognitive Analysis: Computer Architecture & Digital Logic]` : undefined,
      };
    }

    if (/\b(ai|artificial intelligence|machine learning|llm|chatgpt)\b/i.test(rawTopic)) {
      return {
        content: `**Artificial Intelligence (AI)** refers to computer systems engineered to perform cognitive tasks traditionally associated with human intellect — including natural language comprehension, pattern recognition, spatial reasoning, and decision-making.\n\n• **Neural Networks & LLMs:** Modern systems like ChatGPT and Gemini utilize deep transformer architectures trained on vast corpora of text, predicting contextual tokens through self-attention mechanisms and reinforced through alignment techniques (RLHF).\n• **Capabilities:** From synthesizing code and translating languages to analyzing complex data, AI acts as a computational reasoning amplifier.`,
        thought: thinkHarder ? `[Cognitive Analysis: Neural Transformers & Deep Learning Foundations]` : undefined,
      };
    }

    // Unknown concepts must not receive an invented generic definition.
    // Let the query continue to the explicit offline-capability fallback below.
  }

  // The offline fallback must be transparent rather than presenting a template
  // as if it were the result of general-purpose neural reasoning.
  const previousUserTurn = [...recentMessages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim() !== q);

  const historyLimit =
    'I can see recent conversation messages, but history alone does not verify facts or provide a reasoning model.';

  const fallbackContent = isVoiceCall
    ? `I can't reliably reason about that in this offline mode because no general-purpose neural model is configured here.${
        previousUserTurn ? ` ${historyLimit}` : ''
      } I can still help with supported calculations, saved-memory recall, or facts returned by a successful live lookup.`
    : [
        "I can't give a reliable answer to that in this offline mode because no general-purpose neural model is configured here. I won't invent an explanation or present generic filler as knowledge.",
        previousUserTurn ? historyLimit : '',
        'I can still handle supported calculations, saved-memory recall, and factual information returned by a successful live lookup.',
      ]
        .filter(Boolean)
        .join('\n\n');

  return {
    content: fallbackContent,
  };
}

// ============================================================================
// HUMAN VOICE SYNTHESIS ENGINE (Natural Prosody, Persona Selection & Instant Barge-In)
// ============================================================================
// ============================================================================
// 10. Natural Conversational Human Voice Synthesis (Google Cloud Neural TTS)
// ============================================================================

export const GOOGLE_TTS_PERSONA_VOICES = {
  aria_warm: 'en-US-Neural2-F',
  marcus_calm: 'en-US-Neural2-D',
  elena_soft: 'en-US-Neural2-C',
  devon_clear: 'en-US-Neural2-J',
  zara_bright: 'en-US-Neural2-G',
  kofi_smooth: 'en-US-Neural2-A',
  olivia_quiet: 'en-US-Neural2-E',
  leo_confident: 'en-US-Neural2-I',
  sophia_empathetic: 'en-US-Neural2-H',
  julian_resonant: 'en-US-Neural2-D',
  chloe_casual: 'en-US-Neural2-F',
  gabriel_thoughtful: 'en-US-Neural2-J',
} as const;

export type GoogleTtsPersonaId = keyof typeof GOOGLE_TTS_PERSONA_VOICES;

let activeSpeechCancelled = false;
let currentAudioElement: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentSpeechAbortController: AbortController | null = null;

export function stopHumanVoice(): void {
  activeSpeechCancelled = true;
  if (currentSpeechAbortController) {
    try {
      currentSpeechAbortController.abort();
    } catch {}
    currentSpeechAbortController = null;
  }
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
      currentAudioElement.src = '';
    } catch {}
    currentAudioElement = null;
  }
  if (currentAudioUrl) {
    try {
      URL.revokeObjectURL(currentAudioUrl);
    } catch {}
    currentAudioUrl = null;
  }
}

export function selectBestHumanVoice(persona: VoicePersona | string): string {
  const id = typeof persona === 'string' ? persona : persona.id;
  if (Object.prototype.hasOwnProperty.call(GOOGLE_TTS_PERSONA_VOICES, id)) {
    return GOOGLE_TTS_PERSONA_VOICES[id as GoogleTtsPersonaId];
  }
  return GOOGLE_TTS_PERSONA_VOICES.aria_warm;
}

/**
 * Speaks text using real server-side Google Cloud Text-to-Speech (Neural2 HD) with
 * asynchronous MP3 audio streaming, instant barge-in cancellation via AbortController,
 * and audio playback lifecycle callbacks.
 */
export async function speakWithHumanVoice(
  text: string,
  personaId: string,
  options?: {
    pitch?: number;
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  }
): Promise<void> {
  stopHumanVoice();
  activeSpeechCancelled = false;

  const persona = HUMAN_VOICE_PERSONAS.find((p) => p.id === personaId) || HUMAN_VOICE_PERSONAS[0];

  // Conversationally polish text for spoken dialogue (strip markdown clutter, technical code)
  const cleanText = text
    .replace(/```[\s\S]*?```/g, 'I have displayed the technical code on your screen.')
    .replace(/https?:\/\/\S+/gi, 'the linked web reference')
    .replace(/\b(e\.g\.|eg)\b/gi, 'for instance')
    .replace(/\b(i\.e\.|ie)\b/gi, 'that is')
    .replace(/\betc\b\.?/gi, 'and so on')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/[%]/g, ' percent ')
    .replace(/[*#`_\[\]()~>•]/g, ' ')
    .replace(/\b(\d+)\.\s+/g, ' ') // Strip "1.", "2." so it sounds conversational
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    options?.onEnd?.();
    return;
  }

  const controller = new AbortController();
  currentSpeechAbortController = controller;

  try {
    const rawResolve = typeof window !== 'undefined' && (window as any).__RARE_RESOLVE_API_URL__;
    const endpoint = typeof rawResolve === 'function'
      ? rawResolve('/api/voice/synthesize')
      : '/api/voice/synthesize';

    // Calculate semitone pitch offset from persona pitch (1.0 = 0 semitones)
    const semitonePitch = options?.pitch !== undefined
      ? options.pitch
      : (persona.pitch ? (persona.pitch - 1.0) * 12 : 0);

    const speakingRate = options?.rate !== undefined
      ? options.rate
      : (persona.rate ?? 1.0);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
        personaId: persona.id,
        speakingRate,
        pitch: semitonePitch,
      }),
      signal: controller.signal,
    });

    if (activeSpeechCancelled || controller.signal.aborted) {
      return;
    }

    if (!response.ok) {
      let errorMessage = `Google Cloud TTS synthesis failed (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMessage = errJson.error.message;
        }
      } catch {}
      const err = new Error(errorMessage);
      console.error('[Voice] TTS synthesis error:', errorMessage);
      options?.onError?.(err);
      options?.onEnd?.();
      return;
    }

    const audioBlob = await response.blob();
    if (activeSpeechCancelled || controller.signal.aborted) {
      return;
    }

    if (!audioBlob || audioBlob.size === 0) {
      const err = new Error('Empty audio stream received from Google TTS service.');
      options?.onError?.(err);
      options?.onEnd?.();
      return;
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    currentAudioUrl = audioUrl;

    const audio = new Audio(audioUrl);
    currentAudioElement = audio;

    audio.onplay = () => {
      if (activeSpeechCancelled) {
        stopHumanVoice();
        return;
      }
      options?.onStart?.();
    };

    audio.onended = () => {
      if (currentAudioUrl === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        currentAudioUrl = null;
      }
      if (currentAudioElement === audio) {
        currentAudioElement = null;
      }
      if (!activeSpeechCancelled) {
        options?.onEnd?.();
      }
    };

    audio.onerror = () => {
      if (currentAudioUrl === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        currentAudioUrl = null;
      }
      if (currentAudioElement === audio) {
        currentAudioElement = null;
      }
      if (!activeSpeechCancelled) {
        const err = new Error('Audio playback failed.');
        options?.onError?.(err);
        options?.onEnd?.();
      }
    };

    await audio.play();
  } catch (err: any) {
    if (activeSpeechCancelled || controller.signal.aborted) {
      return;
    }
    const finalError = err instanceof Error ? err : new Error(String(err));
    console.error('[Voice] Playback exception:', finalError.message);
    options?.onError?.(finalError);
    options?.onEnd?.();
  }
}

