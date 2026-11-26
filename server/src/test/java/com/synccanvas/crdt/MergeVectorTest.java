package com.synccanvas.crdt;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class MergeVectorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static Stream<JsonNode> mergeVectors() throws IOException {
        Path dir = Path.of(System.getProperty("synccanvas.vectors.dir", "../spec/vectors"));
        JsonNode root = MAPPER.readTree(dir.resolve("merge.json").toFile());
        List<JsonNode> cases = new ArrayList<>();
        root.forEach(cases::add);
        assertThat(cases).isNotEmpty();
        return cases.stream();
    }

    @ParameterizedTest(name = "{index}: {0}")
    @MethodSource("mergeVectors")
    void replaysGoldenMergeVectorAndMatchesTsStateHash(JsonNode vec) {
        String name = vec.get("name").asText();
        LwwMap map = new LwwMap();

        for (JsonNode opNode : vec.get("ops")) {
            Op op = new Op(
                    opNode.get("objectId").asText(),
                    opNode.get("field").asText(),
                    opNode.get("value"),
                    opNode.get("hlc").asText());
            map.apply(op);
        }

        // Verify full register state matches expectState
        JsonNode expectState = vec.get("expectState");
        Map<String, Map<String, Register>> actualState = map.toState();
        assertThat(actualState).as(name).hasSize(expectState.size());

        for (Map.Entry<String, JsonNode> objEntry : expectState.properties()) {
            String objectId = objEntry.getKey();
            JsonNode expectedFields = objEntry.getValue();
            Map<String, Register> actualFields = actualState.get(objectId);
            assertThat(actualFields).as(name + " object " + objectId).isNotNull();
            assertThat(actualFields).as(name + " object " + objectId).hasSize(expectedFields.size());

            for (Map.Entry<String, JsonNode> fieldEntry : expectedFields.properties()) {
                String field = fieldEntry.getKey();
                JsonNode expectedReg = fieldEntry.getValue();
                Register actualReg = actualFields.get(field);
                assertThat(actualReg).as(name + " " + objectId + "." + field).isNotNull();
                assertThat(actualReg.hlc())
                        .as(name + " hlc for " + objectId + "." + field)
                        .isEqualTo(expectedReg.get("hlc").asText());
                assertThat(actualReg.value())
                        .as(name + " value for " + objectId + "." + field)
                        .isEqualTo(expectedReg.get("value"));
            }
        }

        if (vec.has("expectVisibleIds")) {
            List<String> expectedVisible = new ArrayList<>();
            vec.get("expectVisibleIds").forEach(n -> expectedVisible.add(n.asText()));
            assertThat(map.visibleObjectIds()).as(name + " visibleObjectIds").isEqualTo(expectedVisible);
        }

        // Cross-language parity: must match the exact SHA-256 hash produced by TypeScript!
        String expectedHash = vec.get("expectHash").asText();
        assertThat(expectedHash).as(name + " expectHash format").matches("^[0-9a-f]{64}$");
        assertThat(map.stateHash()).as(name + " stateHash parity with TS").isEqualTo(expectedHash);
    }
}
