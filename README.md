These are plugins for the [opencode](opencode.ai) harness. To use them, stick them in `~/.config/opencode/plugins/` (on Unix) or a project plugin directory, `<project>/.opencode/plugins/` and run opencode. The `copy_to_plugins_dir.sh` does this by creating symbolic links to the files here.

# What they are
## summaryexit.ts
This provides /summaryexit, which asks the current model to summarize the session in an output *.md file before opencode exits. This is designed as a cost-saving tool so that you can "save progress" on a large session. 
## deepseek-peak.ts
Provides a little indicator on whether it's currently DeepSeek Peak hours for the official DeepSeek API. 
