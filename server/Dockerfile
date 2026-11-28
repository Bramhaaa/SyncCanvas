FROM gradle:8.14.2-jdk21-alpine AS build
WORKDIR /app

COPY build.gradle.kts settings.gradle.kts gradle.properties* ./
COPY gradle ./gradle
COPY src ./src

RUN gradle bootJar --no-daemon -x test

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN addgroup -S synccanvas && adduser -S synccanvas -G synccanvas
USER synccanvas:synccanvas

COPY --from=build /app/build/libs/app.jar /app/app.jar

EXPOSE 8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=70.0 -XX:+UseSerialGC -Xss256k"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
