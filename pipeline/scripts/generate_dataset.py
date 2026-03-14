import argparse
import json
import os
import subprocess
import sys


def pipeline_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def default_template_file():
    return os.path.join(pipeline_root(), "templates", "base_library.json")


def load_templates(template_file):
    with open(template_file, "r", encoding="utf-8") as handle:
        return json.load(handle)


def cmd_list_templates(args):
    templates = load_templates(args.template_file)
    for template in templates:
        asset = template.get("assetSvg") or "-"
        status = template.get("status", "-")
        print(f"{template['id']:<20} status={status:<20} asset={asset}")


def cmd_show_template(args):
    templates = load_templates(args.template_file)
    matched = next((item for item in templates if item["id"] == args.template_id), None)
    if matched is None:
        raise SystemExit(f"Template not found: {args.template_id}")
    print(json.dumps(matched, ensure_ascii=False, indent=2))


def build_generate_command(args):
    command = [
        "node",
        "src/index.js",
        "--template-file",
        args.template_file,
        "--num-samples",
        str(args.num_samples),
    ]
    if args.dataset_name:
        command.extend(["--dataset-name", args.dataset_name])
    if args.output_dir:
        command.extend(["--output-dir", args.output_dir])
    if args.template:
        command.extend(["--template", args.template])
    return command


def cmd_generate(args):
    command = build_generate_command(args)
    print("Running:", " ".join(command))
    subprocess.run(command, cwd=pipeline_root(), check=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Python entrypoint for the OrigamiSimulator procedural generator.",
    )
    parser.add_argument(
        "--template-file",
        default=default_template_file(),
        help="Path to the base template JSON file.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list-templates", help="List available base templates.")
    list_parser.set_defaults(func=cmd_list_templates)

    show_parser = subparsers.add_parser("show-template", help="Print one base template.")
    show_parser.add_argument("template_id", help="Template id, for example bird_base")
    show_parser.set_defaults(func=cmd_show_template)

    generate_parser = subparsers.add_parser("generate", help="Run the Node generator.")
    generate_parser.add_argument("--num-samples", type=int, default=8, help="Number of procedural samples.")
    generate_parser.add_argument("--dataset-name", default=None, help="Dataset name written into manifests.")
    generate_parser.add_argument("--output-dir", default=None, help="Optional output directory.")
    generate_parser.add_argument(
        "--template",
        default=None,
        help="Optional compound template id, for example bird_base or all.",
    )
    generate_parser.set_defaults(func=cmd_generate)

    return parser.parse_args()


def main():
    args = parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
