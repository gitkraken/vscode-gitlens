pnpm run test;
EXIT_CODE=$?;
if [[ "$EXIT_CODE" == "0" ]]; then
  kill -s SIGINT `cat /var/run/supervisor/supervisord.pid`;
else
  kill -s SIGKILL `cat /var/run/supervisor/supervisord.pid`;
fi
