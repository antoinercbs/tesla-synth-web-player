FROM python:3.8-slim-buster

WORKDIR /python-docker

RUN apt-get update && apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN mkdir front-src
COPY ./tesla-player ./front-src
WORKDIR /python-docker/front-src
RUN touch .env.production
RUN echo 'VUE_APP_BASE_URL=${APP_BASE_URL}' >> .env.production
RUN npm install --quiet --legacy-peer-deps
RUN npm rebuild node-sass
RUN npm run build

WORKDIR /python-docker
RUN mkdir ./public
RUN cp -r ./front-src/dist/* /python-docker/public
RUN rm -rf ./front-src

RUN apt-get remove -y nodejs
RUN apt-get remove -y npm
RUN apt-get autoremove -y

COPY ./flask-backend/requirements.txt requirements.txt
RUN pip3 install -r requirements.txt
COPY ./flask-backend/ .
RUN mkdir uploads
RUN python3 init_db.py

CMD [ "python3", "app.py"]