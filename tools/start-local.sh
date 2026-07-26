#!/bin/sh
# sobe o espelho local do banco + servicos + servidor de teste
cd /home/claude/start-rh
node tools/mock-supabase.js > /tmp/mock.log 2>&1 &
echo $! > /tmp/mock.pid
node tools/mock-servicos.js > /tmp/mocksvc.log 2>&1 &
echo $! > /tmp/mocksvc.pid
sleep 1
node dev-server.js > /tmp/dev.log 2>&1 &
echo $! > /tmp/dev.pid
sleep 2
echo "up"
