import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Sliders,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  RefreshCw,
  Shuffle,
  Upload,
  X,
  SplitSquareVertical,
  Cpu,
  Layers,
  Info,
  CheckCircle2,
  Trash2,
  ArrowRight,
  Eye,
  SlidersHorizontal
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { safeFetch, safePost } from './api';

export interface ImageRecord {
  id: string;
  url: string;
  prompt: string;
  model: 'gemini-3-pro-image-preview' | 'gemini-nano-banana-2.1';
  imageSize: '1K' | '2K' | '4K';
  aspectRatio: string;
  originalUrl?: string;
  createdAt: string;
  mode: 'generate' | 'edit';
  source?: string;
  statusNote?: string;
  quotaExceeded?: boolean;
}

const INSPIRATION_PROMPTS = [
  'A translucent glass bio-dome containing an ancient bonsai tree floating through a celestial nebula, photorealistic 8K, volumetric god rays',
  'Futuristic Tokyo street at midnight drenched in neon rain reflections, cyberpunk aesthetics, anamorphic 35mm lens flare, hyper-detailed',
  'Surreal floating island made of glowing iridescent crystal fractures overlooking an infinite ocean of golden clouds, Octane 3D render',
  'Hyperrealistic portrait of an android architect examining holographic architectural schematics, natural studio softbox lighting, Canon 85mm',
  'Modern minimalist brutalist villa integrated into coastal cliff rocks, monolithic concrete slabs, morning sunlight, architectural photography',
  'Epic fantasy ancient temple covered in glowing runic moss inside an enchanted forest, misty atmospheric depth, trending on ArtStation',
  'Vintage 1980s synthwave sports car speeding along an infinite wireframe neon highway toward a giant retro grid sun, VHS aesthetics',
  'Close-up macro of an intricate mechanical watch movement with ruby bearings and exposed titanium tourbillon, sharp focus, 8K macro',
];

const STYLE_PRESETS = [
  { id: 'cinematic', label: 'Cinematic 35mm', promptSuffix: ', cinematic 35mm film photography, anamorphic lens flare, moody color grading, Kodak Portra 800' },
  { id: 'photoreal', label: 'Photorealistic', promptSuffix: ', hyperrealistic 8K photograph, natural soft studio lighting, ultra-detailed textures, Canon EOS R5' },
  { id: 'cyberpunk', label: 'Cyberpunk Neon', promptSuffix: ', futuristic cyberpunk metropolis, neon reflections in rain puddles, holographic signage, deep atmospheric contrast' },
  { id: 'octane', label: '3D Octane Render', promptSuffix: ', 3D digital concept art, iridescent glass materials, volumetric caustics, Octane render 8K, Ray-traced' },
  { id: 'anime', label: 'Anime Masterpiece', promptSuffix: ', vibrant modern Japanese animation style, Makoto Shinkai aesthetic, dynamic sky with clouds, masterpiece quality' },
  { id: 'concept', label: 'Concept Art', promptSuffix: ', epic fantasy digital painting, atmospheric depth, painterly brushstrokes, trending on ArtStation' },
  { id: 'architecture', label: 'Minimalist Architecture', promptSuffix: ', modern minimalist architecture, raw concrete, geometric shadows, bright morning sunlight, architectural review' },
  { id: 'synthwave', label: 'Retro Synthwave', promptSuffix: ', retro 80s synthwave aesthetic, wireframe neon grid, glowing magenta sun, VHS scanline grain' },
];

const EDIT_SUGGESTIONS = [
  '+ Add Glowing Cybernetic Sunglasses',
  '+ Change Sky to Cosmic Starry Nebula',
  '+ Add Futuristic Neon Rain Reflections',
  '+ Convert into Vintage Oil Painting Style',
  '+ Add Iridescent Mechanical Robot Wings',
  '+ Dramatic Golden Hour Sunset Lighting',
  '+ Add Floating Holographic Interface HUD',
  '+ Surround with Bioluminescent Flora',
];

const SAMPLE_STARTER_IMAGES = [
  {
    id: 'sample_city',
    title: 'Cyber City Skyline',
    prompt: 'Futuristic urban night skyline with neon billboards and skyscrapers',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><defs><linearGradient id="sc1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%230A0E1F"/><stop offset="50%" stop-color="%231E1B4B"/><stop offset="100%" stop-color="%230F172A"/></linearGradient></defs><rect width="800" height="800" fill="url(%23sc1)"/><circle cx="400" cy="280" r="180" fill="%234338CA" fill-opacity="0.4"/><rect x="120" y="380" width="130" height="360" fill="%231E293B"/><rect x="290" y="300" width="180" height="440" fill="%230B0F19" stroke="%236366F1" stroke-width="2"/><rect x="510" y="420" width="150" height="320" fill="%231E293B"/><rect x="330" y="340" width="20" height="20" fill="%2338BDF8"/><rect x="370" y="340" width="20" height="20" fill="%23EC4899"/><rect x="410" y="340" width="20" height="20" fill="%2338BDF8"/><text x="400" y="740" fill="%23A5B4FC" font-family="sans-serif" font-size="20" text-anchor="middle" font-weight="bold">SAMPLE · CYBER CITY</text></svg>',
  },
  {
    id: 'sample_portrait',
    title: 'Studio Portrait',
    prompt: 'Portrait of character with natural lighting in a studio',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><defs><radialGradient id="sp1" cx="50%" cy="40%" r="50%"><stop offset="0%" stop-color="%236366F1" stop-opacity="0.7"/><stop offset="100%" stop-color="%23090D16" stop-opacity="0"/></radialGradient></defs><rect width="800" height="800" fill="%23090D16"/><circle cx="400" cy="360" r="220" fill="url(%23sp1)"/><circle cx="400" cy="340" r="140" fill="%231E293B" stroke="%23818CF8" stroke-width="3"/><path d="M 260 640 Q 400 480 540 640 Z" fill="%231E293B" stroke="%23A5B4FC" stroke-width="2"/><text x="400" y="740" fill="%23C7D2FE" font-family="sans-serif" font-size="20" text-anchor="middle" font-weight="bold">SAMPLE · STUDIO PORTRAIT</text></svg>',
  },
  {
    id: 'sample_nature',
    title: 'Alpine Peak',
    prompt: 'Dramatic mountain peak emerging through morning mist',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><defs><linearGradient id="sm1" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="%23EA580C"/><stop offset="50%" stop-color="%23F59E0B"/><stop offset="100%" stop-color="%230B1320"/></linearGradient></defs><rect width="800" height="800" fill="url(%23sm1)"/><polygon points="400,260 680,680 120,680" fill="%231E293B"/><polygon points="250,380 490,680 30,680" fill="%230F172A"/><polygon points="400,260 450,360 380,380" fill="%23FEF08A"/><text x="400" y="740" fill="%23FED7AA" font-family="sans-serif" font-size="20" text-anchor="middle" font-weight="bold">SAMPLE · ALPINE PEAK</text></svg>',
  },
];

export function ImageStudioWorkspaceView({
  t,
  assistantName,
}: {
  t: ThemeConfig;
  assistantName: string;
}) {
  // Modes: 'generate' (Gemini 3 Pro) vs 'edit' (Nano Banana 2.1) vs 'gallery'
  const [activeTab, setActiveTab] = useState<'generate' | 'edit' | 'gallery'>('generate');

  // Generation Controls (Gemini 3 Pro Image)
  const [prompt, setPrompt] = useState(
    'A bioluminescent mechanical dragon coiled around a crystalline pillar, hyperrealistic 8K, volumetric lighting'
  );
  // Affordance: 1K, 2K, 4K
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('2K');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '4:1' | '1:4'>('1:1');
  const [selectedStyle, setSelectedStyle] = useState<string | null>('cinematic');

  // Edit Controls (Nano Banana 2.1)
  const [editPrompt, setEditPrompt] = useState(
    'Add futuristic glowing cybernetic glasses and holographic purple rain reflections'
  );
  const [editImageSource, setEditImageSource] = useState<string>(SAMPLE_STARTER_IMAGES[0].url);
  const [editImageName, setEditImageName] = useState<string>(SAMPLE_STARTER_IMAGES[0].title);
  const [compareMode, setCompareMode] = useState<'slider' | 'side-by-side' | 'result' | 'original'>('slider');
  const [sliderPosition, setSliderPosition] = useState(50);

  // Active Display Artwork
  const [currentArtwork, setCurrentArtwork] = useState<ImageRecord | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);

  // Gallery state
  const [gallery, setGallery] = useState<ImageRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fullscreenModal, setFullscreenModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sliderContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSliderRef = useRef(false);

  // Load server gallery on mount
  useEffect(() => {
    safeFetch<{ images: ImageRecord[] }>('/api/images/gallery').then((res) => {
      if (res && res.images && res.images.length > 0) {
        setGallery(res.images);
        setCurrentArtwork(res.images[0]);
      }
    });
  }, []);

  // Handle Dragging comparison slider
  const handleSliderMove = (clientX: number) => {
    if (!sliderContainerRef.current) return;
    const rect = sliderContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const percent = Math.round((x / rect.width) * 100);
    setSliderPosition(percent);
  };

  const handleMouseDown = () => {
    isDraggingSliderRef.current = true;
  };

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingSliderRef.current = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSliderRef.current) {
        handleSliderMove(e.clientX);
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingSliderRef.current && e.touches[0]) {
        handleSliderMove(e.touches[0].clientX);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // Handle Shuffle Prompt
  const handleShufflePrompt = () => {
    const random = INSPIRATION_PROMPTS[Math.floor(Math.random() * INSPIRATION_PROMPTS.length)];
    setPrompt(random);
  };

  // Generate with Gemini 3 Pro Image (with 1K, 2K, 4K affordance)
  const handleGenerate = async () => {
    if (!prompt.trim() || isProcessing) return;

    setIsProcessing(true);
    setQuotaBanner(null);
    setProcessingStatus(`Submitting to gemini-3-pro-image-preview at ${imageSize} resolution...`);

    const styleObj = STYLE_PRESETS.find((s) => s.id === selectedStyle);
    const finalPrompt = styleObj ? `${prompt.trim()}${styleObj.promptSuffix}` : prompt.trim();

    try {
      const res = await safePost<{
        success: boolean;
        image: ImageRecord;
        quotaExceeded?: boolean;
        errorDetails?: string;
      }>('/api/images/generate', {
        prompt: finalPrompt,
        model: 'gemini-3-pro-image-preview',
        imageSize,
        aspectRatio,
      });

      if (res && res.image) {
        setCurrentArtwork(res.image);
        setGallery((prev) => [res.image, ...prev.filter((item) => item.id !== res.image.id)]);
        if (res.quotaExceeded) {
          setQuotaBanner(
            `Free-tier quota limit reached for gemini-3-pro-image. High-definition procedural render generated at ${imageSize} resolution.`
          );
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Edit with Gemini Nano Banana 2.1
  const handleEdit = async () => {
    if (!editPrompt.trim() || !editImageSource || isProcessing) return;

    setIsProcessing(true);
    setQuotaBanner(null);
    setProcessingStatus(`Processing prompt edit with gemini-nano-banana-2.1 at ${imageSize}...`);

    try {
      const res = await safePost<{
        success: boolean;
        image: ImageRecord;
        quotaExceeded?: boolean;
      }>('/api/images/edit', {
        image: editImageSource,
        prompt: editPrompt.trim(),
        model: 'gemini-nano-banana-2.1',
        imageSize,
        aspectRatio,
      });

      if (res && res.image) {
        setCurrentArtwork(res.image);
        setGallery((prev) => [res.image, ...prev.filter((item) => item.id !== res.image.id)]);
        if (res.quotaExceeded) {
          setQuotaBanner(
            `Free-tier quota limit reached for gemini-nano-banana-2.1. Rendered modified composite edit at ${imageSize}.`
          );
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Upload Local File
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditImageSource(reader.result);
        setEditImageName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  // Send current artwork directly to Edit mode
  const sendToEditor = (img: ImageRecord) => {
    setEditImageSource(img.url);
    setEditImageName(`From ${img.model.includes('3-pro') ? 'Gemini 3 Pro' : 'Nano Banana'}`);
    setActiveTab('edit');
  };

  // Copy Image Link / Base64 to Clipboard
  const handleCopy = () => {
    if (!currentArtwork) return;
    navigator.clipboard.writeText(currentArtwork.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download PNG
  const handleDownload = () => {
    if (!currentArtwork) return;
    const link = document.createElement('a');
    link.href = currentArtwork.url;
    link.download = `visioncraft-${currentArtwork.model}-${currentArtwork.imageSize}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Delete Image
  const handleDeleteImage = async (id: string) => {
    await safeFetch(`/api/images/gallery/${id}`, { method: 'DELETE' });
    setGallery((prev) => prev.filter((img) => img.id !== id));
    if (currentArtwork?.id === id) {
      setCurrentArtwork(gallery.find((g) => g.id !== id) || null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header & Model Switcher */}
      <div className={`p-5 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm shadow-xl`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className={`w-11 h-11 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-lg shadow-indigo-500/20`}>
              <ImageIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold tracking-tight">VisionCraft Image Studio</h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  Dual-Engine Studio
                </span>
              </div>
              <p className={`text-xs ${t.textMuted} mt-0.5`}>
                High-resolution image synthesis and text-prompt editing powered by Gemini 3 Pro and Nano Banana 2.1.
              </p>
            </div>
          </div>

          {/* Mode Switch Tabs */}
          <div className="flex items-center p-1 rounded-xl bg-black/40 border border-white/5 space-x-1 shrink-0">
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'generate'
                  ? `${t.accentBg} text-white shadow-sm`
                  : `${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate (Gemini 3 Pro)</span>
            </button>

            <button
              onClick={() => setActiveTab('edit')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'edit'
                  ? `${t.accentBg} text-white shadow-sm`
                  : `${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Create & Edit (Nano Banana 2.1)</span>
            </button>

            <button
              onClick={() => setActiveTab('gallery')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'gallery'
                  ? `${t.accentBg} text-white shadow-sm`
                  : `${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Gallery ({gallery.length})</span>
            </button>
          </div>
        </div>

        {/* Quota Banner if free tier limit encountered */}
        {quotaBanner && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Info className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{quotaBanner}</span>
            </div>
            <button
              onClick={() => setQuotaBanner(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Studio Viewport (Sidebar Controls + Canvas) */}
      {activeTab !== 'gallery' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Creator / Editor Controls */}
          <div className="lg:col-span-5 space-y-5">
            {activeTab === 'generate' ? (
              /* ============================================================= */
              /* TAB 1: GENERATE (gemini-3-pro-image-preview with 1K, 2K, 4K)    */
              /* ============================================================= */
              <div className={`p-5 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm space-y-5`}>
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                      gemini-3-pro-image-preview
                    </span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                    Diffusion Flagship
                  </span>
                </div>

                {/* Prompt Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">Prompt Description</label>
                    <button
                      onClick={handleShufflePrompt}
                      className="text-[11px] flex items-center space-x-1 text-slate-400 hover:text-indigo-400 transition"
                      title="Shuffle inspiration prompt"
                    >
                      <Shuffle className="w-3 h-3" />
                      <span>Inspire me</span>
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      rows={4}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Describe the image you want to generate in detail..."
                      className={`w-full p-3.5 rounded-xl bg-black/40 border ${t.cardBorder} text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none transition`}
                    />
                    {prompt && (
                      <button
                        onClick={() => setPrompt('')}
                        className="absolute top-2.5 right-2.5 p-1 rounded-md text-slate-500 hover:text-slate-300 transition"
                        title="Clear prompt"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* RESOLUTION AFFORDANCE: 1K, 2K, 4K (MANDATORY REQUIREMENT) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Image Resolution Affordance</span>
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      {imageSize === '1K' ? '1024 × 1024 px' : imageSize === '2K' ? '2048 × 2048 px' : '4096 × 4096 px'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['1K', '2K', '4K'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setImageSize(size)}
                        className={`py-2.5 px-3 rounded-xl border text-center transition-all ${
                          imageSize === size
                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 border-indigo-400 text-white font-bold shadow-md shadow-indigo-500/25 ring-1 ring-indigo-400'
                            : 'bg-black/30 border-white/5 text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <div className="text-sm tracking-wide font-extrabold">{size}</div>
                        <div className="text-[10px] opacity-75 font-mono">
                          {size === '1K' ? 'Standard HD' : size === '2K' ? 'Crisp QHD' : 'Ultra 4K'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Aspect Ratio Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Aspect Ratio</label>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {(['1:1', '16:9', '9:16', '4:3', '3:4', '4:1', '1:4'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setAspectRatio(ratio)}
                        className={`py-1.5 px-1 rounded-lg text-[11px] font-mono transition text-center border ${
                          aspectRatio === ratio
                            ? 'bg-indigo-600 border-indigo-400 text-white font-bold'
                            : 'bg-black/30 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style Presets */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Style Enhancement</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedStyle(selectedStyle === preset.id ? null : preset.id)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
                          selectedStyle === preset.id
                            ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300 font-semibold'
                            : 'bg-black/20 border-white/5 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Generate Action Button */}
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isProcessing}
                  className={`w-full py-3.5 rounded-xl ${t.accentBg} text-white text-xs font-bold tracking-wide flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{processingStatus || 'Generating Image with Gemini 3 Pro...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate Image with Gemini 3 Pro ({imageSize})</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* ============================================================= */
              /* TAB 2: CREATE & EDIT (gemini-nano-banana-2.1 with Text Prompts) */
              /* ============================================================= */
              <div className={`p-5 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm space-y-5`}>
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      gemini-nano-banana-2.1
                    </span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                    Multimodal Editor
                  </span>
                </div>

                {/* Source Image Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>Source Image to Edit</span>
                    <span className="text-[11px] text-slate-400 truncate max-w-[200px]">{editImageName}</span>
                  </label>

                  {/* Active Source Thumbnail & File Uploader */}
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 shrink-0 bg-black/40 relative group">
                      <img
                        src={editImageSource}
                        alt="Source Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-semibold transition"
                      >
                        Change
                      </button>
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-2 px-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 text-amber-300 text-xs font-medium flex items-center justify-center space-x-1.5 transition"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Custom Photo</span>
                      </button>

                      {currentArtwork && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditImageSource(currentArtwork.url);
                            setEditImageName(`Canvas Image (${currentArtwork.model})`);
                          }}
                          className="w-full py-1 px-3 rounded-lg bg-black/30 hover:bg-black/50 text-slate-300 text-[11px] font-medium transition"
                        >
                          Use Current Canvas Image
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Starter Samples */}
                  <div className="pt-2">
                    <div className="text-[11px] text-slate-400 mb-1.5">Or choose a starter sample:</div>
                    <div className="grid grid-cols-3 gap-2">
                      {SAMPLE_STARTER_IMAGES.map((sample) => (
                        <button
                          key={sample.id}
                          type="button"
                          onClick={() => {
                            setEditImageSource(sample.url);
                            setEditImageName(sample.title);
                          }}
                          className={`p-1.5 rounded-xl border transition text-left flex flex-col items-center ${
                            editImageSource === sample.url
                              ? 'border-amber-400 bg-amber-500/15'
                              : 'border-white/5 bg-black/30 hover:bg-white/5'
                          }`}
                        >
                          <img src={sample.url} alt={sample.title} className="w-12 h-12 rounded object-cover mb-1" />
                          <span className="text-[10px] text-slate-300 text-center truncate w-full">{sample.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Edit Modification Prompt */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Text Prompt for Modification (Nano Banana 2.1)
                  </label>
                  <textarea
                    rows={3}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="Describe how to modify this image (e.g. add sunglasses, change the background)..."
                    className={`w-full p-3.5 rounded-xl bg-black/40 border ${t.cardBorder} text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none transition`}
                  />
                </div>

                {/* Quick Edit Suggestion Pills */}
                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400">Quick Edit Suggestions:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {EDIT_SUGGESTIONS.map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setEditPrompt(sug.replace(/^\+\s*/, ''))}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 transition"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution Affordance (1K, 2K, 4K) */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>Target Output Resolution</span>
                    <span className="text-[10px] font-mono text-slate-400">{imageSize}</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['1K', '2K', '4K'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setImageSize(size)}
                        className={`py-2 px-3 rounded-xl border text-center transition ${
                          imageSize === size
                            ? 'bg-amber-600 border-amber-400 text-white font-bold shadow-md shadow-amber-500/25 ring-1 ring-amber-400'
                            : 'bg-black/30 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        <div className="text-xs font-bold">{size}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit Action Button */}
                <button
                  onClick={handleEdit}
                  disabled={!editPrompt.trim() || !editImageSource || isProcessing}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-500 text-white text-xs font-bold tracking-wide flex items-center justify-center space-x-2 shadow-lg shadow-amber-500/20 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{processingStatus || 'Applying Edit with Nano Banana 2.1...'}</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      <span>Apply Edit with Nano Banana 2.1 ({imageSize})</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Interactive Canvas Viewport & Before/After Comparison */}
          <div className="lg:col-span-7 space-y-4">
            <div className={`p-4 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm shadow-xl space-y-4`}>
              {/* Canvas Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-200">Interactive Canvas Viewport</span>
                  {currentArtwork && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                        currentArtwork.model.includes('3-pro')
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {currentArtwork.model} · {currentArtwork.imageSize}
                    </span>
                  )}
                </div>

                {/* Zoom & Viewport Controls */}
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
                    className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-slate-300 text-xs transition"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono text-slate-400 px-1">{zoomLevel}%</span>
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
                    className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-slate-300 text-xs transition"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setZoomLevel(100)}
                    className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-slate-300 text-xs transition"
                    title="Reset Zoom"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setFullscreenModal(true)}
                    className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-slate-300 text-xs transition"
                    title="Fullscreen"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* In Edit mode with originalUrl: Show Comparison Mode Selector */}
              {currentArtwork?.originalUrl && (
                <div className="flex items-center justify-between p-2 rounded-xl bg-black/30 border border-white/5 text-xs">
                  <span className="text-slate-400 font-medium">Comparison Mode:</span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => setCompareMode('slider')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        compareMode === 'slider' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Interactive Slider
                    </button>
                    <button
                      onClick={() => setCompareMode('side-by-side')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        compareMode === 'side-by-side' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Side by Side
                    </button>
                    <button
                      onClick={() => setCompareMode('original')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        compareMode === 'original' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Original
                    </button>
                    <button
                      onClick={() => setCompareMode('result')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        compareMode === 'result' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Edited Result
                    </button>
                  </div>
                </div>
              )}

              {/* Main Canvas Stage */}
              <div
                className="relative rounded-xl overflow-hidden bg-[#050811] border border-white/10 flex items-center justify-center min-h-[420px] max-h-[620px] select-none"
                style={{
                  backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 0)',
                  backgroundSize: '24px 24px',
                }}
              >
                {currentArtwork ? (
                  currentArtwork.originalUrl && compareMode === 'slider' ? (
                    /* Interactive Drag Slider */
                    <div
                      ref={sliderContainerRef}
                      onMouseDown={handleMouseDown}
                      onTouchStart={handleMouseDown}
                      className="relative w-full h-[450px] overflow-hidden cursor-ew-resize"
                    >
                      {/* Original (Underneath / Left) */}
                      <img
                        src={currentArtwork.originalUrl}
                        alt="Original"
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                      {/* Result (Clipped on top / Right) */}
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ width: `${sliderPosition}%` }}
                      >
                        <img
                          src={currentArtwork.url}
                          alt="Edited"
                          className="absolute inset-0 w-full h-full object-contain"
                          style={{
                            maxWidth: 'none',
                            width: sliderContainerRef.current ? `${sliderContainerRef.current.clientWidth}px` : '100%',
                          }}
                        />
                      </div>

                      {/* Divider Line */}
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)] z-20"
                        style={{ left: `${sliderPosition}%` }}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg cursor-ew-resize">
                          <SplitSquareVertical className="w-4 h-4" />
                        </div>
                      </div>

                      {/* Badges */}
                      <span className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded bg-black/70 text-amber-300 text-[10px] font-bold">
                        Edited Result
                      </span>
                      <span className="absolute top-3 right-3 z-10 px-2 py-0.5 rounded bg-black/70 text-slate-300 text-[10px] font-bold">
                        Original Image
                      </span>
                    </div>
                  ) : currentArtwork.originalUrl && compareMode === 'side-by-side' ? (
                    /* Side-by-side View */
                    <div className="grid grid-cols-2 gap-2 p-2 w-full h-[450px]">
                      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40">
                        <img src={currentArtwork.originalUrl} alt="Original" className="w-full h-full object-contain" />
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-slate-300 text-[10px] font-bold">
                          Original
                        </span>
                      </div>
                      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40">
                        <img src={currentArtwork.url} alt="Edited Result" className="w-full h-full object-contain" />
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-amber-300 text-[10px] font-bold">
                          Edited Result (Nano Banana 2.1)
                        </span>
                      </div>
                    </div>
                  ) : currentArtwork.originalUrl && compareMode === 'original' ? (
                    /* Only Original */
                    <img
                      src={currentArtwork.originalUrl}
                      alt="Original"
                      className="max-h-[500px] w-auto object-contain transition-transform duration-200"
                      style={{ transform: `scale(${zoomLevel / 100})` }}
                    />
                  ) : (
                    /* Single High-Res Image View */
                    <img
                      src={currentArtwork.url}
                      alt={currentArtwork.prompt}
                      className="max-h-[500px] w-auto object-contain transition-transform duration-200"
                      style={{ transform: `scale(${zoomLevel / 100})` }}
                    />
                  )
                ) : (
                  <div className="text-center p-8 space-y-3 text-slate-400">
                    <ImageIcon className="w-12 h-12 mx-auto text-slate-600 animate-pulse" />
                    <p className="text-xs">No artwork generated yet. Choose a model and generate or edit an image!</p>
                  </div>
                )}
              </div>

              {/* Prompt & Technical Metadata Bar */}
              {currentArtwork && (
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
                  <div className="text-xs text-slate-200 font-medium leading-relaxed">
                    "{currentArtwork.prompt}"
                  </div>
                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/5 gap-2">
                    <div className="flex items-center space-x-3">
                      <span>Model: <strong className="text-slate-200">{currentArtwork.model}</strong></span>
                      <span>Resolution: <strong className="text-slate-200">{currentArtwork.imageSize}</strong></span>
                      <span>Aspect: <strong className="text-slate-200">{currentArtwork.aspectRatio}</strong></span>
                    </div>

                    {/* Quick Canvas Actions */}
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => sendToEditor(currentArtwork)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center space-x-1 transition"
                      >
                        <Wand2 className="w-3 h-3" />
                        <span>Send to Nano Banana Editor</span>
                      </button>

                      <button
                        onClick={handleCopy}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-slate-300 transition"
                        title="Copy image link"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={handleDownload}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center space-x-1 shadow transition"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download PNG</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Variations & Presets Strip */}
            {currentArtwork && (
              <div className={`p-4 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm flex items-center justify-between gap-3 text-xs`}>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span className="font-semibold text-slate-200">Quick Variations:</span>
                  <span className="text-slate-400 hidden sm:inline">Add enhancements and re-render</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setPrompt((p) => `${p}, dramatic volumetric lighting, cinematic 35mm lens`);
                      setActiveTab('generate');
                      handleGenerate();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
                  >
                    + Cinematic Lighting
                  </button>
                  <button
                    onClick={() => {
                      setPrompt((p) => `${p}, cyberpunk neon aesthetics, rain puddles`);
                      setActiveTab('generate');
                      handleGenerate();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
                  >
                    + Cyberpunk Retouch
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================================================================= */
        /* TAB 3: GALLERY & CREATION HISTORY                                 */
        /* ================================================================= */
        <div className={`p-6 rounded-2xl ${t.card} ${t.cardBorder} border backdrop-blur-sm space-y-6`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Creation History & Saved Artworks</h3>
              <p className={`text-xs ${t.textMuted}`}>All images generated and prompt-edited in this workspace session.</p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
              {gallery.length} Artworks
            </span>
          </div>

          {gallery.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No saved artworks in gallery.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {gallery.map((img) => (
                <div
                  key={img.id}
                  className={`group relative rounded-xl overflow-hidden border ${t.cardBorder} bg-black/40 hover:border-indigo-400 transition-all flex flex-col justify-between`}
                >
                  <div className="relative aspect-square overflow-hidden bg-black/60">
                    <img src={img.url} alt={img.prompt} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold text-white">
                        {img.imageSize}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          img.model.includes('3-pro') ? 'bg-indigo-600/80 text-white' : 'bg-amber-600/80 text-white'
                        }`}
                      >
                        {img.model.includes('3-pro') ? 'Gemini 3 Pro' : 'Nano Banana'}
                      </span>
                    </div>

                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition duration-200">
                      <button
                        onClick={() => {
                          setCurrentArtwork(img);
                          setActiveTab('generate');
                        }}
                        className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition shadow"
                        title="View on Canvas"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => sendToEditor(img)}
                        className="p-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition shadow"
                        title="Edit with Nano Banana"
                      >
                        <Wand2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteImage(img.id)}
                        className="p-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition shadow"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 space-y-1">
                    <div className="text-[11px] text-slate-300 line-clamp-2 leading-snug">"{img.prompt}"</div>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
                      <span>{new Date(img.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{img.aspectRatio}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {fullscreenModal && currentArtwork && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col p-4 md:p-8">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center space-x-3 text-xs">
              <span className="font-bold text-white">{currentArtwork.model}</span>
              <span className="text-slate-400">· {currentArtwork.imageSize}</span>
              <span className="text-slate-400">· {currentArtwork.aspectRatio}</span>
            </div>
            <button
              onClick={() => setFullscreenModal(false)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={currentArtwork.url}
              alt={currentArtwork.prompt}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="pt-4 text-center text-xs text-slate-300 max-w-2xl mx-auto">
            "{currentArtwork.prompt}"
          </div>
        </div>
      )}
    </div>
  );
}
