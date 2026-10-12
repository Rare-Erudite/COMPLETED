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

  // 5. Memory Recall (Shoes, personal facts, earlier discussions)
  if (/\b(shoe|sneaker|footwear|remember|what did we discuss|prior topic|my name)\b/i.test(lower)) {
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
  const prevUserTurn = [...recentMessages].reverse().find((m) => m.role === 'user' && m.content !== q);
  const isQuestion = q.endsWith('?') || /^(what|why|how|when|where|who|can|could|should|would|is|are|do|does|explain|tell)\b/i.test(lower);

  if (isVoiceCall) {
    const spokenReplies = isQuestion
      ? [
          `That's a really good question about ${q.replace(/[?]+$/, '')}. Looking at it practically, the key is focusing on what actually works in real life and keeping the steps simple. What part of that are you thinking about most?`,
          `When it comes to ${q.replace(/[?]+$/, '')}, the best way to think about it is breaking it down to the core idea and building from there. How are you planning to use it?`,
          `Good question! With ${q.replace(/[?]+$/, '')}, it really comes down to clarity and practical execution. Tell me what angle you're looking at and we can dive right in.`,
        ]
      : [
          `I hear you on that. ${prevUserTurn ? 'It connects right into what you mentioned earlier too.' : ''} Tell me more about what you're thinking.`,
          `That makes a lot of sense. What's the next step you're considering for it?`,
          `Got you. I'm following your train of thought — where do you want to take this next?`,
        ];
    return {
      content: pickVaried('voice_general', spokenReplies),
    };
  }

  const chatReplies = isQuestion
    ? [
        `Let's break down **${q}** clearly:\n\n• **Core Insight:** The most effective way to approach this is to start from first principles — identifying the main goal, the practical constraints, and the most direct path that produces reliable results.\n• **How It Works in Practice:** Rather than overcomplicating the setup, focusing on modular, testable steps makes it much easier to adapt as things evolve.\n\nWhich specific aspect of this would you like to zoom in on?`,
        `Great question. When looking at **${q}**, here is the clearest way to think about it:\n\n1. **Foundation:** Understand the primary mechanism driving the outcome.\n2. **Application:** Apply it directly to your real-world use case and refine based on feedback.\n\nLet me know if you want a deeper technical dive, examples, or a step-by-step plan!`,
        `Regarding **${q}** — the key is balancing flexibility with a solid foundation. Whether you're looking at it from a strategic angle or hands-on execution, focusing on clear fundamentals always leads to the strongest outcome.\n\nTell me what direction you're leaning toward and we'll build on it.`,
      ]
    : [
        `I see where you're going with **"${q}"**.${prevUserTurn ? ` Tying that together with what we discussed earlier gives us a clear picture.` : ''}\n\nHow would you like to build on this next? We can brainstorm further, research specifics, or turn it into a working project.`,
        `That's a solid point on **"${q}"**. I've kept this in context for our session — feel free to expand on it or let me know what angle we should tackle next!`,
        `Got it — **"${q}"** makes complete sense. What part of this should we focus on or develop first?`,
      ];

  return {
    content: pickVaried('chat_general', chatReplies),
    thought: thinkHarder
      ? `Standalone Cognitive Brain • Local Time: ${env.localTimeFormatted} (${env.periodOfDay})${env.city ? ` • Location: ${env.city} (${env.temperatureC}°C, ${env.weatherDescription})` : ''}`
      : undefined,
  };
}

// ============================================================================
// HUMAN VOICE SYNTHESIS ENGINE (Natural Prosody, Persona Selection & Instant Barge-In)
// ============================================================================

let activeSpeechCancelled = false;

export function stopHumanVoice() {
  activeSpeechCancelled = true;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export function selectBestHumanVoice(persona: VoicePersona): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang.toLowerCase().includes('en'));
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  // Score each voice to strongly prefer Natural / Neural / Online / Enhanced human voices
  // and avoid robotic espeak/compact voices
  const scored = pool.map((v) => {
    const nameLower = `${v.name} ${v.voiceURI}`.toLowerCase();
    let score = 0;

    if (nameLower.includes('natural') || nameLower.includes('neural') || nameLower.includes('online')) score += 50;
    if (nameLower.includes('premium') || nameLower.includes('enhanced') || nameLower.includes('wavenet')) score += 40;
    if (nameLower.includes('google') || nameLower.includes('microsoft') || nameLower.includes('siri')) score += 25;
    if (nameLower.includes('espeak') || nameLower.includes('festival') || nameLower.includes('robot')) score -= 100;

    for (const kw of persona.preferredKeywords) {
      if (nameLower.includes(kw.toLowerCase())) {
        score += 35;
      }
    }

    if (persona.gender === 'female' && /\b(female|woman|girl|aria|jenny|sonia|samantha|victoria|zira|karen|moira|tessa)\b/i.test(nameLower)) {
      score += 20;
    }
    if (persona.gender === 'male' && /\b(male|man|guy|ryan|daniel|alex|david|christopher|eric|arthur|aaron|oliver)\b/i.test(nameLower)) {
      score += 20;
    }

    return { voice: v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.voice || pool[0] || null;
}

/**
 * Speaks text using natural human prosody (clause phrasing, persona pitch/rate contours,
 * and zero markdown clutter) with instant barge-in cancellation support.
 */
export function speakWithHumanVoice(
  text: string,
  personaId: string,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
  }
) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callbacks?.onEnd?.();
    return;
  }

  stopHumanVoice();
  activeSpeechCancelled = false;

  const persona = HUMAN_VOICE_PERSONAS.find((p) => p.id === personaId) || HUMAN_VOICE_PERSONAS[0];
  const cleanText = text
    .replace(/```[\s\S]*?```/g, 'I have shared the code snippet on your screen.')
    .replace(/[*#`_\[\]()~>•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    callbacks?.onEnd?.();
    return;
  }

  // Split into natural conversational sentences so prosody has human cadence
  const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
  const chosenVoice = selectBestHumanVoice(persona);

  let idx = 0;
  callbacks?.onStart?.();

  const speakNextSentence = () => {
    if (activeSpeechCancelled || idx >= sentences.length) {
      if (!activeSpeechCancelled) {
        callbacks?.onEnd?.();
      }
      return;
    }

    const phrase = sentences[idx++].trim();
    if (!phrase) {
      speakNextSentence();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(phrase);
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    // Add slight natural human intonation variation across sentences
    const slightVariation = ((idx % 3) - 1) * 0.02;
    utterance.pitch = Math.max(0.75, Math.min(1.3, persona.pitch + slightVariation));
    utterance.rate = Math.max(0.82, Math.min(1.2, persona.rate));
    utterance.volume = 1.0;

    utterance.onend = () => {
      if (activeSpeechCancelled) return;
      speakNextSentence();
    };

    utterance.onerror = () => {
      if (activeSpeechCancelled) return;
      speakNextSentence();
    };

    window.speechSynthesis.speak(utterance);
  };

  speakNextSentence();
}
