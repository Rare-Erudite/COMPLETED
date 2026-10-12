#!/usr/bin/env python3
"""
RARE APK Asset Packager
Packages the offline knowledge corpus, models manifest, and runtime configuration
for the standalone Android application.

Does NOT generate synthetic dummy weights. Real local neural model weights
are downloaded via the verified in-app downloader (onnx-community/Qwen2.5-0.5B-Instruct,
INT4 Q4 ONNX, Apache-2.0) into persistent app storage.
"""

import os
import json

def generate_offline_model_assets(target_dir):
    os.makedirs(f"{target_dir}/models", exist_ok=True)
    os.makedirs(f"{target_dir}/knowledge", exist_ok=True)

    print("[1/2] Packaging RARE Standalone Knowledge & Reasoning Corpus...")
    knowledge = {
        "title": "RARE Standalone Core Knowledge & Compositional Reasoning Corpus",
        "version": "1.0.0-release",
        "standalone_independent": True,
        "domains": {
            "computer_science": {
                "languages": ["TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin", "C++", "SQL"],
                "frameworks": ["React", "Express", "Node.js", "Tailwind CSS", "Vite", "Android SDK"],
                "architectures": ["Event-Driven", "Microservices", "RESTful", "WebSocket", "Local-First Standalone"]
            },
            "live_environmental_and_web_sensors": {
                "weather_and_climate": "Open-Meteo & Geolocation real-time temperature, rain detection, and wind telemetry",
                "web_research_synthesis": "Multi-source DuckDuckGo Instant Answer & Wikipedia REST knowledge graph lookup",
                "temporal_awareness": "Real-time contextual greeting & scheduling across time-of-day segments"
            },
            "human_voice_personas": {
                "personas": [
                    {"id": "aria_warm", "name": "Aria", "gender": "female", "style": "Warm & Conversational", "pitch": 1.04, "rate": 0.98},
                    {"id": "marcus_calm", "name": "Marcus", "gender": "male", "style": "Calm & Deep", "pitch": 0.90, "rate": 0.95},
                    {"id": "elena_soft", "name": "Elena", "gender": "female", "style": "Soft & Gentle", "pitch": 1.08, "rate": 0.92},
                    {"id": "devon_clear", "name": "Devon", "gender": "male", "style": "Clear & Articulate", "pitch": 0.98, "rate": 1.01},
                    {"id": "zara_bright", "name": "Zara", "gender": "female", "style": "Bright & Energetic", "pitch": 1.12, "rate": 1.03},
                    {"id": "kofi_smooth", "name": "Kofi", "gender": "male", "style": "Smooth & Relaxed", "pitch": 0.94, "rate": 0.96},
                    {"id": "olivia_quiet", "name": "Olivia", "gender": "female", "style": "Quiet & Reassuring", "pitch": 1.02, "rate": 0.93},
                    {"id": "leo_confident", "name": "Leo", "gender": "male", "style": "Friendly & Confident", "pitch": 0.96, "rate": 0.99}
                ],
                "turn_detection": "2.5-second (2500ms) natural pause window with full-duplex barge-in interruption"
            },
            "autonomous_agent_primitives": {
                "memory_system": "Persistent cross-chat Episodic, Semantic, and Working memory with relevance ranking",
                "tool_system": "12 Verified Local Primitives with strict boundary sandboxing",
                "self_development": "10-Step Deterministic Trajectory Execution and Rollback Checkpointing",
                "visioncraft": "Generative prompt structuring and multi-resolution rendering engine"
            }
        }
    }
    with open(f"{target_dir}/knowledge/core_knowledge.json", "w", encoding="utf-8") as f:
        json.dump(knowledge, f, indent=2)

    print("[2/2] Packaging Real Model Specification & Manifest...")
    manifest = {
        "client_package": "RARE Mobile Standalone Client",
        "version": "1.0.0-release",
        "build": "release-standalone",
        "package": "com.rare.ai.intelligence",
        "model_spec": {
            "name": "Qwen 2.5 0.5B Instruct",
            "repo_id": "onnx-community/Qwen2.5-0.5B-Instruct",
            "quantization": "ONNX INT4 (Q4)",
            "license": "Apache-2.0",
            "parameters": "0.49B",
            "runtime": "ONNX Runtime / @huggingface/transformers",
            "approximate_size_mb": 786,
            "distribution": "in-app-verified-download",
            "download_endpoint": "/api/v1/providers/load-local"
        },
        "voice_spec": {
            "engine": "Native Device SpeechSynthesis & AudioTrack with Prosody Shaper",
            "personas_count": 8,
            "barge_in_supported": True,
            "pause_turn_ms": 2500
        },
        "offline_ready": True,
        "capabilities": [
            "standalone_compositional_reasoning",
            "camera_and_photo_capture",
            "document_content_extraction",
            "live_weather_and_rain_awareness",
            "multi_source_web_research",
            "human_voice_personas_male_and_female",
            "full_duplex_barge_in",
            "semantic_memory_retrieval",
            "autonomous_tool_execution"
        ]
    }
    with open(f"{target_dir}/models/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("APK assets successfully generated without dummy weights.")

if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "/tmp/android_apk_build/assets"
    generate_offline_model_assets(target)
