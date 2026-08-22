#!/bin/bash

mkdir -p ~/.config/opencode/plugins ~/.config/opencode/command
for plugin in *.ts; do
	ln -sfn "$PWD/${plugin}" ~/.config/opencode/plugins/"$plugin"
done
for cmd in *.md; do
	[ "${cmd}" = "README.md" ] && continue
	ln -sfn "$PWD/${cmd}" ~/.config/opencode/command/"${cmd}"
done
