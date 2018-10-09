FROM rickydunlop/nodejs-ffmpeg

WORKDIR /app
COPY . .

RUN npm install --production

EXPOSE 3000
CMD ["npm", "start"]