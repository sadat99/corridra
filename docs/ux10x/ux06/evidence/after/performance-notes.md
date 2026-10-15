# Bounded lab performance

18 cold-context samples: home, plan and workspaces at 1440/390, three samples per route/width, isolated local production build in Chromium. CPU throttled 4x; RTT 150 ms and download 1.5 Mbit/s. Maximum observed LCP 1736 ms; every bounded CLS observation 0; attempted writes 0. These observations meet the stated 2500 ms/0.1 lab thresholds for these samples.

This is not field p75, INP, Lighthouse scoring or production performance acceptance. The original-production FCP and current-local paint samples use different environments and do not establish a performance improvement. An initial lab attempt overlapped public-server shutdown, stopped with connection refusal and is retained separately as an incomplete measurement. The complete stable-server run supersedes it for the stated 18-sample result. No analytics or production instrumentation was installed.
