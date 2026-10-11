# RARE voice system

RARE Live Conversation uses native speech recognition for input and a local neural Piper voice for speech output. The client does not use the old platform TTS API for its primary voice path.

The configured voice is `en_US-lessac-medium`. The model is downloaded once during the build preparation step and copied into the application bundle/app support directory. The final Windows/Android artifacts therefore carry the voice model and do not require a separate TTS service at runtime.

Voice controls include live listening, wake-name arming, thinking/speaking states, interruption/cancellation, keyboard fallback, and automatic continuation of listening after a completed turn where the platform speech recognizer supports it.
