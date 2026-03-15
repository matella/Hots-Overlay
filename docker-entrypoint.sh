#!/bin/sh
set -e

# Start SSH daemon (Azure App Service SSH / remote access on port 2222)
/usr/sbin/sshd

# Start the application
exec node server.js
