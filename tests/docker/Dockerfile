FROM selenium/node-base:4.22.0

USER root

RUN apt-get update && \
    apt-get install -y \
    apt-transport-https \
    ca-certificates \
    software-properties-common \
    gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev \
    git && \
    rm -rf /var/lib/apt/lists/*

RUN rm /etc/supervisor/conf.d/selenium.conf

COPY supervisor.conf /etc/supervisor/conf.d/supervisor.conf

# --- --- --- --- --- --- ---
# Install Node/NPM
# --- --- --- --- --- --- ---

# enable node source repo
RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -
# enable yarn repo
# RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
# RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list

# install node and pnpm
RUN apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9
