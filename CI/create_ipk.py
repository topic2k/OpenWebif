#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import glob
import re
import time
import shutil
import tarfile
import tempfile
import compileall
import subprocess
import struct
import ast

fmt_pattern = re.compile(r'%(?:\((?:\w+)\))?[#0\- +]?(?:\*|\d+)?(?:\.(?:\*|\d+))?[hlL]?[diouxXeEfFgGcrs%]')

def parse_po(po_text):
    entries = {}
    lines = po_text.splitlines()
    state = None
    cur_id = []
    cur_str = []
    is_fuzzy = False

    def commit():
        nonlocal cur_id, cur_str, is_fuzzy
        if cur_id:
            k = ''.join(cur_id)
            v = ''.join(cur_str)
            # If msgid is empty, it is the PO header metadata
            if k == "":
                entries[k] = v
            elif v and not is_fuzzy:
                # Validate format specifiers match
                k_fmts = [m.group(0) for m in fmt_pattern.finditer(k) if m.group(0) != '%%']
                v_fmts = [m.group(0) for m in fmt_pattern.finditer(v) if m.group(0) != '%%']
                if len(k_fmts) == len(v_fmts):
                    entries[k] = v
        cur_id = []
        cur_str = []
        is_fuzzy = False

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith('#'):
            if 'fuzzy' in line:
                is_fuzzy = True
            continue
        if line.startswith('msgid '):
            commit()
            state = 'msgid'
            val = line[6:].strip()
            cur_id.append(ast.literal_eval(val))
        elif line.startswith('msgstr '):
            state = 'msgstr'
            val = line[7:].strip()
            cur_str.append(ast.literal_eval(val))
        elif line.startswith('"'):
            val = ast.literal_eval(line)
            if state == 'msgid':
                cur_id.append(val)
            elif state == 'msgstr':
                cur_str.append(val)
    commit()
    return entries

def generate_mo(entries):
    keys = sorted(entries.keys())
    num_strings = len(keys)
    header_size = 28
    tables_size = 2 * num_strings * 8
    data_start = header_size + tables_size

    orig_table = []
    trans_table = []
    orig_data = bytearray()
    trans_data = bytearray()

    curr_orig_offset = data_start
    for k in keys:
        b_k = k.encode('utf-8') + b'\x00'
        orig_table.append((len(k.encode('utf-8')), curr_orig_offset))
        orig_data.extend(b_k)
        curr_orig_offset += len(b_k)

    curr_trans_offset = curr_orig_offset
    for k in keys:
        v = entries[k]
        b_v = v.encode('utf-8') + b'\x00'
        trans_table.append((len(v.encode('utf-8')), curr_trans_offset))
        trans_data.extend(b_v)
        curr_trans_offset += len(b_v)

    header = struct.pack('<Iiiiiii',
        0x950412de, 0, num_strings,
        28, 28 + num_strings * 8, 0, 28 + num_strings * 16
    )

    table_bytes = bytearray()
    for l, off in orig_table:
        table_bytes.extend(struct.pack('<II', l, off))
    for l, off in trans_table:
        table_bytes.extend(struct.pack('<II', l, off))

    return header + table_bytes + orig_data + trans_data

def compile_po_file(po_path, mo_path):
    os.makedirs(os.path.dirname(mo_path), exist_ok=True)
    with open(po_path, 'r', encoding='utf-8', errors='replace') as f:
        entries = parse_po(f.read())
    mo_bytes = generate_mo(entries)
    with open(mo_path, 'wb') as f:
        f.write(mo_bytes)

def write_ar(output_path, entries):
    with open(output_path, 'wb') as f:
        f.write(b'!<arch>\n')
        for name, data in entries:
            hdr = f"{name:<16}{int(time.time()):<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}\x60\n".encode('ascii')
            f.write(hdr)
            f.write(data)
            if len(data) % 2 != 0:
                f.write(b'\n')

def get_version(root_dir):
    ver = "2.4.0"
    changes_path = os.path.join(root_dir, "CHANGES.md")
    if os.path.exists(changes_path):
        with open(changes_path, "r", encoding="utf-8") as f:
            for line in f:
                m = re.search(r'## Version\s+([0-9]+\.[0-9]+\.[0-9]+)', line, re.IGNORECASE)
                if m:
                    ver = m.group(1)
                    break

    build_date = time.strftime('%Y%m%d')
    try:
        git_date = subprocess.check_output(
            ["git", "log", "-1", '--format=%cd', '--date=format:%Y%m%d'],
            cwd=root_dir, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        git_date = build_date

    # Revisions belong to the base version, not to a particular build date.
    pkg_pattern = re.compile(
        rf'enigma2-plugin-extensions-openwebif_{re.escape(ver)}-git(\d{{8}})-r(\d+)_all\.ipk'
    )
    latest_date = max(build_date, git_date) if re.fullmatch(r'\d{8}', git_date) else build_date
    latest_revision = -1
    for entry in os.scandir(root_dir):
        match = pkg_pattern.fullmatch(entry.name)
        if match and entry.is_file():
            latest_date = max(latest_date, match.group(1))
            latest_revision = max(latest_revision, int(match.group(2)))

    git_ver = f"git{latest_date}-r{latest_revision + 1}"

    return ver, git_ver

def get_build_branch(root_dir):
    try:
        return subprocess.check_output(
            ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
            cwd=root_dir, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""

def build_ipk(root_dir):
    ver, git_ver = get_version(root_dir)
    pkg_ver = f"{ver}-{git_ver}"
    pkg_filename = f"enigma2-plugin-extensions-openwebif_{pkg_ver}_all.ipk"
    pkg_path = os.path.join(root_dir, pkg_filename)

    print(f"Building OpenWebif IPK package: {pkg_filename}")
    print(f"Version: {pkg_ver}")

    with tempfile.TemporaryDirectory() as tmpdir:
        stage_dir = os.path.join(tmpdir, "stage")
        build_dir = os.path.join(tmpdir, "build")
        control_dir = os.path.join(stage_dir, "CONTROL")
        target_plugin_dir = os.path.join(stage_dir, "usr", "lib", "enigma2", "python", "Plugins", "Extensions", "OpenWebif")

        os.makedirs(control_dir, exist_ok=True)
        os.makedirs(build_dir, exist_ok=True)
        os.makedirs(target_plugin_dir, exist_ok=True)

        control_content = f"""Package: enigma2-plugin-extensions-openwebif
Version: {pkg_ver}
Description: Control your receiver with a browser
Architecture: all
Section: extra
Priority: optional
Maintainer: E2OpenPlugins members
Homepage: https://github.com/oe-alliance/OpenWebif
Depends: python3-json, python3-cheetah, python3-pyopenssl, python3-unixadmin, python3-misc, python3-twisted-web, python3-pprint, python3-compression, python3-ipaddress
Source: https://github.com/oe-alliance/OpenWebif
"""
        with open(os.path.join(control_dir, "control"), "w", encoding="utf-8", newline="\n") as f:
            f.write(control_content)

        postinst_content = """#!/bin/sh
find /usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/ -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find /usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/ -name "*.pyc" -delete 2>/dev/null || true
exit 0
"""
        postinst_path = os.path.join(control_dir, "postinst")
        with open(postinst_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(postinst_content)
        os.chmod(postinst_path, 0o755)

        # Copy plugin source files
        plugin_src = os.path.join(root_dir, "plugin")
        for item in os.listdir(plugin_src):
            src_item = os.path.join(plugin_src, item)
            dst_item = os.path.join(target_plugin_dir, item)
            if os.path.isdir(src_item):
                if item not in ("__pycache__", ".git"):
                    shutil.copytree(src_item, dst_item, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'))
            elif item != "build_branch":
                shutil.copy2(src_item, dst_item)

        branch = get_build_branch(root_dir)
        if branch:
            with open(os.path.join(target_plugin_dir, "build_branch"), "w", encoding="utf-8", newline="\n") as f:
                f.write(f"{branch}\n")

        # Compile translations
        locale_src = os.path.join(root_dir, "locale")
        for po_file in glob.glob(os.path.join(locale_src, "*.po")):
            lang = os.path.splitext(os.path.basename(po_file))[0]
            mo_dest = os.path.join(target_plugin_dir, "locale", lang, "LC_MESSAGES", "OpenWebif.mo")
            compile_po_file(po_file, mo_dest)
        print("Compiled localization catalog (.mo) files.")

        # Compile Cheetah templates
        try:
            subprocess.check_call(
                ["uv", "run", "--with", "CT3", "cheetah", "compile", "--nobackup", "-R", target_plugin_dir],
                cwd=root_dir
            )
            print("Compiled Cheetah templates.")
        except Exception as e:
            print(f"Warning: Cheetah compile via uv failed ({e}), trying direct cheetah command...")
            try:
                subprocess.check_call(["cheetah", "compile", "--nobackup", "-R", target_plugin_dir])
            except Exception as e2:
                print(f"Error compiling Cheetah templates: {e2}")
                raise

        # Compile python files
        compileall.compile_dir(target_plugin_dir, force=True, quiet=1, optimize=1)
        print("Compiled Python bytecode.")

        # Create control.tar.gz
        control_tar_path = os.path.join(build_dir, "control.tar.gz")
        with tarfile.open(control_tar_path, "w:gz", format=tarfile.GNU_FORMAT) as tar:
            for root, _, files in os.walk(control_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, control_dir).replace("\\", "/")
                    tar_info = tar.gettarinfo(full_path, arcname=f"./{rel_path}")
                    tar_info.uid = 0
                    tar_info.gid = 0
                    tar_info.uname = "root"
                    tar_info.gname = "root"
                    tar_info.mode = 0o755 if file in ("postinst", "postrm", "preinst", "prerm") else 0o644
                    with open(full_path, "rb") as f:
                        tar.addfile(tar_info, f)

        # Remove CONTROL dir before packaging data.tar.gz
        shutil.rmtree(control_dir)

        # Create data.tar.gz
        data_tar_path = os.path.join(build_dir, "data.tar.gz")
        with tarfile.open(data_tar_path, "w:gz", format=tarfile.GNU_FORMAT) as tar:
            for root, dirs, files in os.walk(stage_dir):
                dirs.sort()
                files.sort()
                for d in dirs:
                    full_path = os.path.join(root, d)
                    rel_path = os.path.relpath(full_path, stage_dir).replace("\\", "/")
                    tar_info = tar.gettarinfo(full_path, arcname=f"./{rel_path}")
                    tar_info.uid = 0
                    tar_info.gid = 0
                    tar_info.uname = "root"
                    tar_info.gname = "root"
                    tar_info.mode = 0o755
                    tar.addfile(tar_info)
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, stage_dir).replace("\\", "/")
                    tar_info = tar.gettarinfo(full_path, arcname=f"./{rel_path}")
                    tar_info.uid = 0
                    tar_info.gid = 0
                    tar_info.uname = "root"
                    tar_info.gname = "root"
                    tar_info.mode = 0o755 if file.endswith((".sh", ".py")) and "bin" in rel_path else 0o644
                    with open(full_path, "rb") as f:
                        tar.addfile(tar_info, f)

        # Build IPK ar archive
        with open(control_tar_path, "rb") as f:
            control_data = f.read()
        with open(data_tar_path, "rb") as f:
            data_data = f.read()

        entries = [
            ("debian-binary", b"2.0\n"),
            ("data.tar.gz", data_data),
            ("control.tar.gz", control_data)
        ]
        write_ar(pkg_path, entries)

    print(f"IPK package successfully built: {pkg_path} ({os.path.getsize(pkg_path)} bytes)")
    return pkg_path

if __name__ == "__main__":
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    build_ipk(root_dir)
