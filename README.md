These are plugins for the [opencode](opencode.ai) harness. To install them via symlinks, run `install.sh` (linux/mac/WSL) or `install.ps1` (Windows). You can also just make a symlink or copy them yourself to your opencode plugins dir.

# What they are
## summaryexit.ts
This provides /summaryexit, which asks the current model to summarize the session in an output `session_summary-ses_<sessionID>.md` file before opencode exits. This is designed as a cost-saving tool so that you can "save progress" on a large session. 
## deepseek-peak.ts
Provides a little indicator on whether it's currently DeepSeek Peak hours for the official DeepSeek API. 
## opencode-offpeak.sh
Not actually a plugin--a shell script to time release of a prompt to DeepSeek when off-peak hours begin. Doesn't handle killing opencode when peak hours resume.
