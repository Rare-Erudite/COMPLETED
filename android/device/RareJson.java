package com.rare.ai.intelligence;

/**
 * Minimal JSON writer for the device bridge.
 *
 * The bridge must return structured data to the WebView, and pulling a JSON
 * library into a hand-built APK (no Gradle, no dependency resolution) is not
 * worth it. This writer covers exactly what the bridge emits: objects, arrays,
 * strings, numbers and booleans. It is deliberately small and allocation-light.
 *
 * Adapted from the JSON-escaping rules in the Android platform's own
 * org.json.JSONStringer (Apache-2.0) — only the escaping table is reused, the
 * builder API here is RARE's own.
 */
final class RareJson {
    private final StringBuilder out = new StringBuilder(512);
    private boolean needsComma = false;

    static String escape(String value) {
        if (value == null) return "";
        StringBuilder sb = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    RareJson beginObject() { comma(); out.append('{'); needsComma = false; return this; }
    RareJson endObject() { out.append('}'); needsComma = true; return this; }
    RareJson beginArray() { comma(); out.append('['); needsComma = false; return this; }
    RareJson endArray() { out.append(']'); needsComma = true; return this; }

    private void comma() {
        if (needsComma) out.append(',');
        needsComma = false;
    }

    private RareJson key(String name) {
        comma();
        out.append('"').append(escape(name)).append("\":");
        needsComma = false;
        return this;
    }

    RareJson put(String name, String value) {
        key(name);
        if (value == null) out.append("null");
        else out.append('"').append(escape(value)).append('"');
        needsComma = true;
        return this;
    }

    RareJson put(String name, long value) { key(name); out.append(value); needsComma = true; return this; }
    RareJson put(String name, double value) { key(name); out.append(value); needsComma = true; return this; }
    RareJson put(String name, boolean value) { key(name); out.append(value); needsComma = true; return this; }

    RareJson value(String value) {
        comma();
        if (value == null) out.append("null");
        else out.append('"').append(escape(value)).append('"');
        needsComma = true;
        return this;
    }

    @Override public String toString() { return out.toString(); }
}
