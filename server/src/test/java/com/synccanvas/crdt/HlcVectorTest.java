package com.synccanvas.crdt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class HlcVectorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static Stream<JsonNode> hlcVectors() throws IOException {
        Path dir = Path.of(System.getProperty("synccanvas.vectors.dir", "../spec/vectors"));
        JsonNode root = MAPPER.readTree(dir.resolve("hlc.json").toFile());
        List<JsonNode> cases = new ArrayList<>();
        root.forEach(cases::add);
        assertThat(cases).isNotEmpty();
        return cases.stream();
    }

    @ParameterizedTest(name = "{index}: {0}")
    @MethodSource("hlcVectors")
    void replaysGoldenHlcVector(JsonNode vec) {
        String name = vec.get("name").asText();
        String nodeId = vec.get("nodeId").asText();
        long maxDriftMs = vec.has("maxDriftMs")
                ? vec.get("maxDriftMs").asLong()
                : HlcClock.DEFAULT_MAX_DRIFT_MS;

        AtomicLong now = new AtomicLong(0L);
        HlcClock clock = vec.has("initial")
                ? new HlcClock(nodeId, now::get, maxDriftMs, Hlc.parse(vec.get("initial").asText()))
                : new HlcClock(nodeId, now::get, maxDriftMs);

        for (JsonNode step : vec.get("steps")) {
            now.set(step.get("now").asLong());
            String op = step.get("op").asText();

            if ("tick".equals(op)) {
                String expected = step.get("expect").asText();
                Hlc ticked = clock.tick();
                assertThat(ticked.format()).as(name).isEqualTo(expected);
                assertThat(clock.last().format()).as(name).isEqualTo(expected);
            } else if ("recv".equals(op)) {
                Hlc remote = Hlc.parse(step.get("remote").asText());
                if (step.has("expectError") && "CLOCK_SKEW".equals(step.get("expectError").asText())) {
                    String before = clock.last().format();
                    assertThatThrownBy(() -> clock.receive(remote))
                            .as(name)
                            .isInstanceOf(ClockSkewException.class);
                    assertThat(clock.last().format()).as(name).isEqualTo(before);
                } else {
                    String expected = step.get("expect").asText();
                    clock.receive(remote);
                    assertThat(clock.last().format()).as(name).isEqualTo(expected);
                }
            } else {
                throw new IllegalArgumentException("Unknown HLC vector step op: " + op);
            }
        }
    }
}
