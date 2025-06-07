
FROM node:16-alpine as base


FROM base as builder

RUN npm config set unsafe-perm true

WORKDIR /code

COPY ./ /code

RUN npm install

RUN rm -f .npmrc

FROM node:16-alpine


ENV NODE_ENV production

RUN npm i -g pm2

# Create app directory
WORKDIR /home/app

# Copy the built application
COPY --from=builder ["/code", "/home/app"]

ENV HOME="/home/app"

EXPOSE 8000

CMD ["pm2-runtime", "index.js"]
