package com.rare.ai.intelligence;

import android.content.Context;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * RARE — Vosk model manager (optional offline hotword engine).
 *
 * Vosk is an Apache-2.0 on-device speech recogniser. The small English model
 * (vosk-model-small-en-us-0.15) is also Apache-2.0. It is NOT bundled in the
 * APK: the user downloads it from inside the app, and only then does the wake
 * word run without a network connection.
 *
 * Everything here reports the real state of the filesystem. A model is only
 * "ready" when the expected directory exists and contains the files Vosk needs;
 * a partial or corrupt download is deleted rather than reported as usable.
 */
public final class VoskModelManager {
    private static final String TAG = "RARE_VOSK";

    /** The model the app offers. Apache-2.0, published by Alpha Cephei. */
    public static final String MODEL_NAME = "vosk-model-small-en-us-0.15";
    public static final String MODEL_URL =
            "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
    /** Exact byte size of the download, verified against Content-Length. */
    public static final long MODEL_ZIP_BYTES = 41_205_931L;
    /** Approximate size on disk after extraction. */
    public static final long MODEL_UNPACKED_BYTES = 40_000_000L;
    public static final String MODEL_LICENCE = "Apache-2.0";

    private static volatile boolean downloading = false;
    private static volatile int progressPercent = 0;
    private static volatile String lastError = "";

    private VoskModelManager() {}

    /** Root directory that holds the extracted model. */
    public static File modelRoot(Context context) {
        return new File(context.getFilesDir(), "vosk");
    }

    /** The directory Vosk's Model(String) constructor expects. */
    public static File modelDir(Context context) {
        return new File(modelRoot(context), MODEL_NAME);
    }

    /**
     * True only when the model directory exists and contains the files Vosk
     * requires. A half-extracted directory is not "ready".
     */
    public static boolean isModelReady(Context context) {
        File dir = modelDir(context);
        if (!dir.isDirectory()) return false;
        // Vosk needs the acoustic model, the HCLG graph and the word list.
        return new File(dir, "am/final.mdl").isFile()
                && new File(dir, "conf/mfcc.conf").isFile()
                && new File(dir, "graph/HCLr.fst").isFile()
                && new File(dir, "graph/Gr.fst").isFile();
    }

    public static boolean isDownloading() {
        return downloading;
    }

    public static int progress() {
        return progressPercent;
    }

    public static String lastError() {
        return lastError;
    }

    /** Human-readable status for the UI. Never claims readiness it cannot prove. */
    public static String status(Context context) {
        if (downloading) return "downloading " + progressPercent + "%";
        if (isModelReady(context)) return "ready (offline)";
        if (lastError != null && !lastError.isEmpty()) return "error: " + lastError;
        return "not installed";
    }

    /**
     * Downloads and extracts the model. Blocking — call from a background thread.
     * Returns true only when the extracted model passes isModelReady().
     */
    public static synchronized boolean download(Context context) {
        if (downloading) return false;
        if (isModelReady(context)) return true;

        downloading = true;
        progressPercent = 0;
        lastError = "";

        File root = modelRoot(context);
        File tmpZip = new File(root, MODEL_NAME + ".zip.part");
        File staging = new File(root, MODEL_NAME + ".staging");
        File target = modelDir(context);

        try {
            if (!root.isDirectory() && !root.mkdirs()) {
                throw new IOException("Could not create the model directory.");
            }
            deleteRecursively(staging);
            if (!staging.mkdirs()) throw new IOException("Could not create the staging directory.");

            long downloaded = downloadToFile(MODEL_URL, tmpZip);
            if (downloaded <= 0) throw new IOException("The download returned no data.");
            // Verify against the published size when the server sent one.
            if (MODEL_ZIP_BYTES > 0 && downloaded != MODEL_ZIP_BYTES) {
                throw new IOException(
                        "Downloaded " + downloaded + " bytes but expected " + MODEL_ZIP_BYTES + ".");
            }

            unzip(tmpZip, staging);

            // The zip contains a single top-level directory named MODEL_NAME.
            File extracted = new File(staging, MODEL_NAME);
            if (!extracted.isDirectory()) {
                // Some archives omit the wrapper directory; accept that layout too.
                extracted = staging;
            }

            deleteRecursively(target);
            if (!extracted.renameTo(target)) {
                // renameTo can fail across filesystems; fall back to a copy.
                copyDirectory(extracted, target);
            }

            if (!isModelReady(context)) {
                throw new IOException("The extracted model is incomplete.");
            }
            Log.i(TAG, "Vosk model installed at " + target.getAbsolutePath());
            return true;
        } catch (Exception e) {
            lastError = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            Log.e(TAG, "Model download failed: " + lastError);
            deleteRecursively(target);
            return false;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            tmpZip.delete();
            deleteRecursively(staging);
            downloading = false;
        }
    }

    /** Removes the downloaded model. The wake word falls back to the online engine. */
    public static synchronized void delete(Context context) {
        deleteRecursively(modelDir(context));
        lastError = "";
        progressPercent = 0;
    }

    private static long downloadToFile(String urlString, File destination) throws IOException {
        HttpURLConnection connection = null;
        InputStream input = null;
        OutputStream output = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "RARE-Android/1.0");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("The model server answered HTTP " + status + ".");
            }
            long total = connection.getContentLengthLong();
            input = new BufferedInputStream(connection.getInputStream(), 64 * 1024);
            output = new FileOutputStream(destination);
            byte[] buffer = new byte[64 * 1024];
            long written = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                written += read;
                if (total > 0) {
                    progressPercent = (int) Math.min(99, (written * 100) / total);
                }
            }
            output.flush();
            progressPercent = 100;
            return written;
        } finally {
            if (output != null) try { output.close(); } catch (IOException ignored) {}
            if (input != null) try { input.close(); } catch (IOException ignored) {}
            if (connection != null) connection.disconnect();
        }
    }

    private static void unzip(File zip, File destination) throws IOException {
        ZipInputStream zis = null;
        try {
            zis = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zip)));
            ZipEntry entry;
            byte[] buffer = new byte[64 * 1024];
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(destination, entry.getName());
                // Zip-slip defence: never write outside the destination.
                String canonicalDest = destination.getCanonicalPath();
                if (!outFile.getCanonicalPath().startsWith(canonicalDest + File.separator)
                        && !outFile.getCanonicalPath().equals(canonicalDest)) {
                    throw new IOException("The archive contains an unsafe path.");
                }
                if (entry.isDirectory()) {
                    if (!outFile.isDirectory() && !outFile.mkdirs()) {
                        throw new IOException("Could not create " + outFile.getName());
                    }
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("Could not create " + parent.getName());
                    }
                    OutputStream out = new FileOutputStream(outFile);
                    try {
                        int read;
                        while ((read = zis.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                        }
                    } finally {
                        out.close();
                    }
                }
                zis.closeEntry();
            }
        } finally {
            if (zis != null) try { zis.close(); } catch (IOException ignored) {}
        }
    }

    private static void copyDirectory(File source, File destination) throws IOException {
        if (!destination.isDirectory() && !destination.mkdirs()) {
            throw new IOException("Could not create " + destination.getName());
        }
        File[] children = source.listFiles();
        if (children == null) return;
        for (File child : children) {
            File target = new File(destination, child.getName());
            if (child.isDirectory()) {
                copyDirectory(child, target);
            } else {
                InputStream in = new java.io.FileInputStream(child);
                OutputStream out = new FileOutputStream(target);
                try {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                } finally {
                    in.close();
                    out.close();
                }
            }
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
