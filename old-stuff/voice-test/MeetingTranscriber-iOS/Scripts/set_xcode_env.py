#!/usr/bin/env python3
import sys
import xml.etree.ElementTree as ET

def main():
    if len(sys.argv) < 4:
        print("Usage: set_xcode_env.py SCHEME_PATH SPEECH_KEY SPEECH_REGION")
        sys.exit(1)

    scheme_path, key, region = sys.argv[1], sys.argv[2], sys.argv[3]
    tree = ET.parse(scheme_path)
    root = tree.getroot()

    # Find <EnvironmentVariables> under <LaunchAction>
    launch = root.find('.//LaunchAction')
    if launch is None:
        print("LaunchAction not found in scheme")
        sys.exit(1)
    envs = launch.find('EnvironmentVariables')
    if envs is None:
        envs = ET.SubElement(launch, 'EnvironmentVariables')

    def upsert(name, value):
        for var in envs.findall('EnvironmentVariable'):
            if var.get('key') == name:
                var.set('value', value)
                var.set('isEnabled', 'YES')
                return
        ET.SubElement(envs, 'EnvironmentVariable', key=name, value=value, isEnabled='YES')

    upsert('SPEECH_KEY', key)
    upsert('SPEECH_REGION', region)

    tree.write(scheme_path, encoding='utf-8')
    print(f"Updated {scheme_path} with env vars.")

if __name__ == '__main__':
    main()

