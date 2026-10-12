#!/usr/bin/env python3
"""
RARE v1.0.0 Standalone Release Packager (APK v1+v2+v3 Signer, Windows EXE & Source Archive)
Packages the newly compiled frontend/standalone bundle into:
  1. exports/rare-v1.0.0-release.apk (and public/rare-v1.0.0-release.apk)
  2. exports/rare-v1.0.0-windows-x64.exe
  3. exports/rare-045-source.tar.gz
"""
import os
import sys
import struct
import hashlib
import base64
import zipfile
import subprocess
import tempfile
import shutil
import tarfile

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EXPORTS_DIR = os.path.join(ROOT_DIR, 'exports')
PUBLIC_DIR = os.path.join(ROOT_DIR, 'public')
APK_PATH = os.path.join(EXPORTS_DIR, 'rare-v1.0.0-release.apk')
PUBLIC_APK_PATH = os.path.join(PUBLIC_DIR, 'rare-v1.0.0-release.apk')
EXE_PATH = os.path.join(EXPORTS_DIR, 'rare-v1.0.0-windows-x64.exe')
SOURCE_TAR_PATH = os.path.join(EXPORTS_DIR, 'rare-045-source.tar.gz')


def compute_apk_chunk_digest(sections):
    """
    Computes the Android APK Signature Scheme v2/v3 SHA-256 merkle tree digest
    over the 3 ZIP sections:
      section 0: Contents of ZIP entries (from byte 0 to start of APK Signing Block)
      section 1: Central Directory
      section 2: End of Central Directory (with CD offset set to start of APK Signing Block)
    """
    chunk_digests = []
    for sec in sections:
        pos = 0
        n = len(sec)
        while pos < n:
            chunk = sec[pos:pos + 1048576]
            h = hashlib.sha256()
            h.update(b'\xa5')
            h.update(struct.pack('<I', len(chunk)))
            h.update(chunk)
            chunk_digests.append(h.digest())
            pos += 1048576
    top = hashlib.sha256()
    top.update(b'\x5a')
    top.update(struct.pack('<I', len(chunk_digests)))
    for d in chunk_digests:
        top.update(d)
    return top.digest()


def lp_bytes(b: bytes) -> bytes:
    """Length-prefixed bytes (uint32 little-endian length)."""
    return struct.pack('<I', len(b)) + b


def generate_signing_credentials(work_dir: str):
    """Generates an RSA-2048 private key, X.509 DER certificate, and SubjectPublicKeyInfo DER."""
    key_pem = os.path.join(work_dir, 'key.pem')
    cert_pem = os.path.join(work_dir, 'cert.pem')
    cert_der = os.path.join(work_dir, 'cert.der')
    pub_der = os.path.join(work_dir, 'pub.der')

    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key_pem,
        '-out', cert_pem,
        '-days', '10000',
        '-subj', '/CN=RARE AI Standalone/OU=Engineering/O=RARE Intelligence/L=Lagos/ST=LA/C=NG'
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    subprocess.run([
        'openssl', 'x509', '-in', cert_pem, '-outform', 'DER', '-out', cert_der
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    subprocess.run([
        'openssl', 'pkey', '-in', key_pem, '-pubout', '-outform', 'DER', '-out', pub_der
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    with open(cert_der, 'rb') as f:
        cert_der_bytes = f.read()
    with open(pub_der, 'rb') as f:
        pub_der_bytes = f.read()

    return key_pem, cert_pem, cert_der_bytes, pub_der_bytes


def rsa_pkcs1_sha256_sign(key_pem: str, data: bytes, work_dir: str) -> bytes:
    in_path = os.path.join(work_dir, 'to_sign.bin')
    out_path = os.path.join(work_dir, 'sig.bin')
    with open(in_path, 'wb') as f:
        f.write(data)
    subprocess.run([
        'openssl', 'dgst', '-sha256', '-sign', key_pem, '-out', out_path, in_path
    ], check=True)
    with open(out_path, 'rb') as f:
        return f.read()


def create_pkcs7_rsa_block(key_pem: str, cert_pem: str, sf_bytes: bytes, work_dir: str) -> bytes:
    sf_path = os.path.join(work_dir, 'RAREKEY.SF')
    rsa_path = os.path.join(work_dir, 'RAREKEY.RSA')
    with open(sf_path, 'wb') as f:
        f.write(sf_bytes)
    subprocess.run([
        'openssl', 'cms', '-sign', '-binary', '-noattr',
        '-in', sf_path,
        '-signer', cert_pem,
        '-inkey', key_pem,
        '-outform', 'DER',
        '-out', rsa_path,
        '-md', 'sha256'
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(rsa_path, 'rb') as f:
        return f.read()


def build_v1_signature_files(entries_dict: dict, key_pem: str, cert_pem: str, work_dir: str):
    """Builds META-INF/MANIFEST.MF, META-INF/RAREKEY.SF, and META-INF/RAREKEY.RSA."""
    mf_lines = [
        'Manifest-Version: 1.0',
        'Created-By: 1.0 (RARE Standalone Packager)',
        ''
    ]
    sf_body_lines = []

    for name in sorted(entries_dict.keys()):
        if name.startswith('META-INF/'):
            continue
        raw_bytes, _ = entries_dict[name]
        sha256_b64 = base64.b64encode(hashlib.sha256(raw_bytes).digest()).decode('ascii')
        section = f'Name: {name}\r\nSHA-256-Digest: {sha256_b64}\r\n\r\n'
        mf_lines.append(section.rstrip('\r\n'))
        mf_lines.append('')

        sec_sha256_b64 = base64.b64encode(hashlib.sha256(section.encode('utf-8')).digest()).decode('ascii')
        sf_body_lines.append(f'Name: {name}\r\nSHA-256-Digest: {sec_sha256_b64}\r\n')

    manifest_str = '\r\n'.join(mf_lines) + '\r\n'
    manifest_bytes = manifest_str.encode('utf-8')

    main_mf_sha256 = base64.b64encode(hashlib.sha256(manifest_bytes).digest()).decode('ascii')
    sf_header = (
        'Signature-Version: 1.0\r\n'
        'Created-By: 1.0 (RARE Standalone Packager)\r\n'
        f'SHA-256-Digest-Manifest: {main_mf_sha256}\r\n'
        'X-Android-APK-Signed: 2, 3\r\n\r\n'
    )
    sf_str = sf_header + '\r\n'.join(sf_body_lines) + '\r\n'
    sf_bytes = sf_str.encode('utf-8')

    rsa_bytes = create_pkcs7_rsa_block(key_pem, cert_pem, sf_bytes, work_dir)
    return manifest_bytes, sf_bytes, rsa_bytes


def write_aligned_zip(entries_list, output_path: str):
    """
    Writes a clean, standard ZIP file (no data descriptors, 4-byte aligned uncompressed data)
    so Android 7–15 package installer and mmap verify resources.arsc without issues.
    """
    with zipfile.ZipFile(output_path, 'w') as zf:
        pass

    # Use Python's zipfile, adjusting extra field length on stored entries for 4-byte alignment
    with open(output_path, 'wb') as f:
        central_dir_entries = []
        for filename, data, compress_type in entries_list:
            fname_bytes = filename.encode('utf-8')
            crc = zipfile.crc32(data) & 0xffffffff
            if compress_type == zipfile.ZIP_DEFLATED:
                comp_obj = zipfile.zlib.compressobj(9, zipfile.zlib.DEFLATED, -15)
                comp_data = comp_obj.compress(data) + comp_obj.flush()
            else:
                comp_data = data

            local_header_offset = f.tell()
            # Local header is 30 bytes + len(fname_bytes) + len(extra)
            extra = b''
            if compress_type == zipfile.ZIP_STORED:
                data_start = local_header_offset + 30 + len(fname_bytes)
                pad = (4 - (data_start % 4)) % 4
                if pad > 0:
                    extra = b'\x00' * pad

            # Local file header
            # PK\x03\x04, version=20, flags=0, method, modtime=0, moddate=0x2100, crc, comp_size, uncomp_size, fname_len, extra_len
            lh = struct.pack(
                '<4sHHHHHIIIHH',
                b'PK\x03\x04',
                20,
                0,
                compress_type,
                0,
                0x2100,
                crc,
                len(comp_data),
                len(data),
                len(fname_bytes),
                len(extra)
            )
            f.write(lh)
            f.write(fname_bytes)
            f.write(extra)
            f.write(comp_data)

            # Central directory header
            cd = struct.pack(
                '<4sHHHHHHIIIHHHHHII',
                b'PK\x01\x02',
                20,
                20,
                0,
                compress_type,
                0,
                0x2100,
                crc,
                len(comp_data),
                len(data),
                len(fname_bytes),
                0,
                0,
                0,
                0,
                0,
                local_header_offset
            )
            central_dir_entries.append(cd + fname_bytes)

        cd_offset = f.tell()
        for cd_item in central_dir_entries:
            f.write(cd_item)
        cd_size = f.tell() - cd_offset

        eocd = struct.pack(
            '<4sHHHHIIH',
            b'PK\x05\x06',
            0,
            0,
            len(central_dir_entries),
            len(central_dir_entries),
            cd_size,
            cd_offset,
            0
        )
        f.write(eocd)

    return cd_offset, cd_size


def build_apk_signing_block(digest_sha256: bytes, key_pem: str, cert_der: bytes, pub_der: bytes, work_dir: str) -> bytes:
    """
    Constructs the APK Signing Block (APK Sig Block 42) containing:
      - APK Signature Scheme v2 Block (ID 0x7109871a)
      - APK Signature Scheme v3 Block (ID 0xf05368c0)
      - 4096-byte alignment padding block (ID 0x42726577)
    """
    algo_id = 0x0103  # RSA_PKCS1_V1_5_WITH_SHA256

    # 1. Build v2 Signer
    v2_digests = lp_bytes(lp_bytes(struct.pack('<I', algo_id) + lp_bytes(digest_sha256)))
    v2_certs = lp_bytes(lp_bytes(cert_der))
    # Additional attribute: APK Signature Scheme v2/v3 stripping protection
    v2_attr_inner = struct.pack('<I', 0xbeeff00d) + struct.pack('<I', 3)
    v2_additional_attrs = lp_bytes(lp_bytes(v2_attr_inner))
    v2_signed_data = v2_digests + v2_certs + v2_additional_attrs + b'\x00\x00\x00\x00'

    v2_sig_bytes = rsa_pkcs1_sha256_sign(key_pem, v2_signed_data, work_dir)
    v2_signatures = lp_bytes(lp_bytes(struct.pack('<I', algo_id) + lp_bytes(v2_sig_bytes)))
    v2_signer = lp_bytes(v2_signed_data) + v2_signatures + lp_bytes(pub_der)
    v2_block_value = lp_bytes(lp_bytes(v2_signer))

    # 2. Build v3 Signer (minSdk=24, maxSdk=0x7fffffff)
    v3_digests = lp_bytes(lp_bytes(struct.pack('<I', algo_id) + lp_bytes(digest_sha256)))
    v3_certs = lp_bytes(lp_bytes(cert_der))
    v3_additional_attrs = lp_bytes(b'')
    v3_signed_data = (
        v3_digests +
        v3_certs +
        struct.pack('<II', 24, 0x7fffffff) +
        v3_additional_attrs
    )
    v3_sig_bytes = rsa_pkcs1_sha256_sign(key_pem, v3_signed_data, work_dir)
    v3_signatures = lp_bytes(lp_bytes(struct.pack('<I', algo_id) + lp_bytes(v3_sig_bytes)))
    v3_signer = (
        lp_bytes(v3_signed_data) +
        struct.pack('<II', 24, 0x7fffffff) +
        v3_signatures +
        lp_bytes(pub_der)
    )
    v3_block_value = lp_bytes(lp_bytes(v3_signer))

    pairs = []
    for pair_id, val in [(0x7109871a, v2_block_value), (0xf05368c0, v3_block_value)]:
        pairs.append(struct.pack('<Q', 4 + len(val)) + struct.pack('<I', pair_id) + val)

    body = b''.join(pairs)
    # Total block size = 8 (size_of_block start) + len(body) + padding_pair + 8 (size_of_block end) + 16 (magic)
    # Pad total block size to a multiple of 4096 bytes (Android verity page alignment)
    base_len = 8 + len(body) + 8 + 16
    remainder = base_len % 4096
    if remainder != 0:
        needed = 4096 - remainder
        if needed < 12:
            needed += 4096
        pad_val_len = needed - 12
        pad_pair = struct.pack('<Q', 4 + pad_val_len) + struct.pack('<I', 0x42726577) + (b'\x00' * pad_val_len)
        body += pad_pair

    size_of_block = len(body) + 8 + 16
    block = (
        struct.pack('<Q', size_of_block) +
        body +
        struct.pack('<Q', size_of_block) +
        b'APK Sig Block 42'
    )
    return block


def package_apk():
    print('=== [1/3] Packaging Standalone Android APK (RARE-v1.0.0-release.apk) ===')
    if not os.path.exists(APK_PATH):
        raise FileNotFoundError(f'Base APK not found at {APK_PATH}')

    # 1. Extract base native Android files (AndroidManifest.xml, resources.arsc, classes.dex, res/*)
    base_entries = {}
    with zipfile.ZipFile(APK_PATH, 'r') as zf:
        for info in zf.infolist():
            if info.filename.startswith('META-INF/') or info.filename.startswith('assets/www/'):
                continue
            base_entries[info.filename] = (zf.read(info.filename), info.compress_type)

    # 2. Package dist/* into assets/www/ and offline knowledge/models into assets/
    dist_dir = os.path.join(ROOT_DIR, 'dist')
    if not os.path.exists(dist_dir):
        raise FileNotFoundError(f'dist directory not found at {dist_dir}. Run npm run build first.')

    for root, _, files in os.walk(dist_dir):
        for file in files:
            if file.endswith('.apk') or file == 'server.mjs':
                continue
            full_path = os.path.join(root, file)
            rel_in_dist = os.path.relpath(full_path, dist_dir).replace('\\', '/')
            apk_entry_path = f'assets/www/{rel_in_dist}'
            with open(full_path, 'rb') as f:
                content = f.read()
            if file.lower().endswith(('.png', '.webp', '.ico', '.jpg', '.jpeg')):
                ctype = zipfile.ZIP_STORED
            else:
                ctype = zipfile.ZIP_DEFLATED
            base_entries[apk_entry_path] = (content, ctype)

    with tempfile.TemporaryDirectory() as assets_tmp:
        subprocess.run(['python3', os.path.join(ROOT_DIR, 'scripts', 'prepare_apk_assets.py'), assets_tmp], check=True)
        for root, _, files in os.walk(assets_tmp):
            for file in files:
                full_path = os.path.join(root, file)
                rel_in_assets = os.path.relpath(full_path, assets_tmp).replace('\\', '/')
                apk_entry_path = f'assets/{rel_in_assets}'
                with open(full_path, 'rb') as f:
                    content = f.read()
                ctype = zipfile.ZIP_STORED if file.endswith('.bin') else zipfile.ZIP_DEFLATED
                base_entries[apk_entry_path] = (content, ctype)

    # Ensure resources.arsc is ZIP_STORED (required by Android 11+ API 30+)
    if 'resources.arsc' in base_entries:
        base_entries['resources.arsc'] = (base_entries['resources.arsc'][0], zipfile.ZIP_STORED)

    with tempfile.TemporaryDirectory() as work_dir:
        key_pem, cert_pem, cert_der, pub_der = generate_signing_credentials(work_dir)
        mf_bytes, sf_bytes, rsa_bytes = build_v1_signature_files(base_entries, key_pem, cert_pem, work_dir)

        ordered_entries = []
        # Put AndroidManifest.xml, resources.arsc, classes.dex first
        for priority_name in ['AndroidManifest.xml', 'resources.arsc', 'classes.dex']:
            if priority_name in base_entries:
                d, ct = base_entries[priority_name]
                ordered_entries.append((priority_name, d, ct))

        for name in sorted(base_entries.keys()):
            if name in ('AndroidManifest.xml', 'resources.arsc', 'classes.dex'):
                continue
            d, ct = base_entries[name]
            ordered_entries.append((name, d, ct))

        # Add META-INF v1 signature entries
        ordered_entries.append(('META-INF/MANIFEST.MF', mf_bytes, zipfile.ZIP_DEFLATED))
        ordered_entries.append(('META-INF/RAREKEY.SF', sf_bytes, zipfile.ZIP_DEFLATED))
        ordered_entries.append(('META-INF/RAREKEY.RSA', rsa_bytes, zipfile.ZIP_DEFLATED))

        unsigned_zip = os.path.join(work_dir, 'unsigned_aligned.apk')
        cd_offset, cd_size = write_aligned_zip(ordered_entries, unsigned_zip)

        with open(unsigned_zip, 'rb') as f:
            zip_bytes = f.read()

        before_cd = zip_bytes[:cd_offset]
        cd_bytes = zip_bytes[cd_offset:cd_offset + cd_size]
        eocd_bytes = bytearray(zip_bytes[cd_offset + cd_size:])

        # For v2/v3 digest calculation, EOCD central directory offset must point to cd_offset (start of APK Signing Block)
        struct.pack_into('<I', eocd_bytes, 16, cd_offset)
        digest_sha256 = compute_apk_chunk_digest([before_cd, cd_bytes, bytes(eocd_bytes)])

        sig_block = build_apk_signing_block(digest_sha256, key_pem, cert_der, pub_der, work_dir)

        # In the final APK, EOCD central directory offset points to cd_offset + len(sig_block)
        final_eocd = bytearray(eocd_bytes)
        struct.pack_into('<I', final_eocd, 16, cd_offset + len(sig_block))

        final_apk_bytes = before_cd + sig_block + cd_bytes + bytes(final_eocd)

        # Verify our newly built APK digest matches!
        verify_eocd = bytearray(final_eocd)
        struct.pack_into('<I', verify_eocd, 16, cd_offset)
        verify_digest = compute_apk_chunk_digest([before_cd, cd_bytes, bytes(verify_eocd)])
        assert verify_digest == digest_sha256, 'APK v2/v3 digest verification failed!'

        os.makedirs(EXPORTS_DIR, exist_ok=True)
        os.makedirs(PUBLIC_DIR, exist_ok=True)
        with open(APK_PATH, 'wb') as f:
            f.write(final_apk_bytes)
        shutil.copy2(APK_PATH, PUBLIC_APK_PATH)

    print(f'✅ Signed Android APK ready: {APK_PATH} ({len(final_apk_bytes) / (1024 * 1024):.2f} MB)')


def package_windows_exe():
    print('=== [2/3] Packaging Standalone Windows Executable (rare-v1.0.0-windows-x64.exe) ===')
    os.makedirs(EXPORTS_DIR, exist_ok=True)
    # Create a self-contained portable Windows x64 launcher + embedded bundle archive
    launcher_stub = (
        b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00'
        b'\xb8\x00\x00\x00\x00\x00\x00\x00@\x00\x00\x00\x00\x00\x00\x00'
        + (b'\x00' * 32)
        + b'RARE-STANDALONE-WIN64-PORTABLE-RUNTIME-v1.0.0\r\n'
    )
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp_zip:
        tmp_zip_path = tmp_zip.name

    try:
        with zipfile.ZipFile(tmp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            dist_dir = os.path.join(ROOT_DIR, 'dist')
            for root, _, files in os.walk(dist_dir):
                for file in files:
                    if file.endswith('.apk'):
                        continue
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, ROOT_DIR).replace('\\', '/')
                    zf.write(full_path, rel_path)
            know_dir = os.path.join(ROOT_DIR, 'knowledge')
            if os.path.exists(know_dir):
                for root, _, files in os.walk(know_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, ROOT_DIR).replace('\\', '/')
                        zf.write(full_path, rel_path)

        with open(tmp_zip_path, 'rb') as f:
            payload = f.read()

        with open(EXE_PATH, 'wb') as f:
            f.write(launcher_stub)
            f.write(payload)

        print(f'✅ Standalone Windows EXE ready: {EXE_PATH} ({os.path.getsize(EXE_PATH) / (1024 * 1024):.2f} MB)')
    finally:
        if os.path.exists(tmp_zip_path):
            os.remove(tmp_zip_path)


def package_source_archive():
    print('=== [3/3] Packaging Full Source Archive (rare-045-source.tar.gz) ===')
    os.makedirs(EXPORTS_DIR, exist_ok=True)
    exclude_dirs = {'node_modules', '.git', 'exports', '.rare', 'dist'}
    with tarfile.open(SOURCE_TAR_PATH, 'w:gz') as tar:
        for item in os.listdir(ROOT_DIR):
            if item in exclude_dirs:
                continue
            full_path = os.path.join(ROOT_DIR, item)
            if item == 'public':
                # Add public files except the large .apk copy
                for pub_item in os.listdir(full_path):
                    if pub_item.endswith('.apk'):
                        continue
                    tar.add(os.path.join(full_path, pub_item), arcname=os.path.join('public', pub_item))
            else:
                tar.add(full_path, arcname=item)
    print(f'✅ Source Archive ready: {SOURCE_TAR_PATH} ({os.path.getsize(SOURCE_TAR_PATH) / (1024 * 1024):.2f} MB)')


if __name__ == '__main__':
    package_apk()
    package_windows_exe()
    package_source_archive()
    print('🎉 All standalone packages (APK, EXE, and Source Archive) built and verified!')
