import os
import sys
import zipfile

def make_macos_zip(app_bundle_path, output_zip_path):
    print(f"Packaging {app_bundle_path} -> {output_zip_path} with UNIX POSIX permissions...")
    parent_dir = os.path.dirname(os.path.abspath(app_bundle_path))
    
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(app_bundle_path):
            for d in dirs:
                full_path = os.path.join(root, d)
                rel_path = os.path.relpath(full_path, parent_dir).replace('\\', '/') + '/'
                zinfo = zipfile.ZipInfo(rel_path)
                zinfo.create_system = 3  # UNIX
                zinfo.external_attr = (0o40755 << 16) | 0x10  # directory + rwxr-xr-x
                zf.writestr(zinfo, '')
                
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, parent_dir).replace('\\', '/')
                zinfo = zipfile.ZipInfo(rel_path)
                zinfo.create_system = 3  # UNIX
                # Executable binary in Contents/MacOS must have 0755 permissions
                is_executable = (f == 'WaterPoloBoard') or ('Contents/MacOS' in rel_path and not f.endswith('.pdb'))
                mode = 0o100755 if is_executable else 0o100644
                zinfo.external_attr = mode << 16
                with open(full_path, 'rb') as fp:
                    zf.writestr(zinfo, fp.read(), compress_type=zipfile.ZIP_DEFLATED)
                    
    print(f"Done! Size: {os.path.getsize(output_zip_path) / 1024 / 1024:.1f} MB")

if __name__ == '__main__':
    src = sys.argv[1]
    out = sys.argv[2]
    make_macos_zip(src, out)
