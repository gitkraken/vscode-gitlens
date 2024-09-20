#!/bin/bash

docker build . -t e2e-test

cd ../../

npm install -g pnpm
pnpm install
mkdir -p out

CONTAINER_NAME=e2e-test

echo "Docker containers"
docker ps -a

echo "Docker images"
docker image list

docker rm -f e2e-test | true

LOG_ID=$(docker run \
  -e SCREEN_WIDTH=1680 -e SCREEN_HEIGHT=1050 \
  -e TZ="Etc/UTC" \
  -d --name=${CONTAINER_NAME} \
  -v /dev/shm:/dev/shm --privileged \
  -v /dev/snd:/dev/snd \
  -v /etc/localtime:/etc/localtime:ro \
  -v ./:/opt/vscode-gitlens \
  e2e-test)

echo "Run docker with id $LOG_ID"

EXIT_CODE=$(docker wait $LOG_ID)

echo "Exited with code $EXIT_CODE"

docker logs e2e-test

exit $EXIT_CODE

# Add following options to get an access from host:
# -p 5900:25900 \  - to VNC
