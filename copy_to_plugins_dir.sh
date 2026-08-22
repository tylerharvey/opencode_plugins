#!/bin/bash

mkdir -p ~/.config/opencode/plugins
for plugin in *.ts; do
	ln -sfn "$PWD/${plugin}" ~/.config/opencode/plugins/"$plugin"
done
