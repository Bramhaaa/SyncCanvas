package com.synccanvas.protocol;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.synccanvas.config.LimitsProperties;
import com.synccanvas.crdt.Hlc;
import com.synccanvas.crdt.LwwMap;
import com.synccanvas.crdt.Op;
import java.util.List;
import org.junit.jupiter.api.Test;

class OpValidatorTest {

    private static final long NOW = 1_732_579_200_000L;
    private static final String CLIENT = "user_a";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OpValidator validator = new OpValidator(LimitsProperties.defaults(), () -> NOW);

    private static String hlc(long pt, int counter, String node) {
        return new Hlc(pt, counter, node).format();
    }

    @Test
    void acceptsValidCreationBatchAndSubsequentEdits() {
        LwwMap map = new LwwMap();
        List<Op> create = List.of(
                new Op("obj_rect01", "type", TextNode.valueOf("rect"), hlc(NOW, 0, CLIENT)),
                new Op("obj_rect01", "x", IntNode.valueOf(10), hlc(NOW, 1, CLIENT)),
                new Op("obj_rect01", "y", DoubleNode.valueOf(20.5), hlc(NOW, 2, CLIENT)),
                new Op("obj_rect01", "w", IntNode.valueOf(100), hlc(NOW, 3, CLIENT)),
                new Op("obj_rect01", "h", IntNode.valueOf(80), hlc(NOW, 4, CLIENT)),
                new Op("obj_rect01", "fill", TextNode.valueOf("#3B82F6"), hlc(NOW, 5, CLIENT)),
                new Op("obj_rect01", "zIndex", TextNode.valueOf("a0"), hlc(NOW, 6, CLIENT)));

        assertThat(validator.validateBatch(CLIENT, create, map))
                .isInstanceOf(ValidationResult.Valid.class);

        create.forEach(map::apply);

        // Subsequent edit resolves type from board state
        List<Op> edit = List.of(
                new Op("obj_rect01", "fill", TextNode.valueOf("transparent"), hlc(NOW + 10, 0, CLIENT)),
                new Op("obj_rect01", "deleted", BooleanNode.valueOf(true), hlc(NOW + 10, 1, CLIENT)));
        assertThat(validator.validateBatch(CLIENT, edit, map))
                .isInstanceOf(ValidationResult.Valid.class);
    }

    @Test
    void rejectsClockSkewExceedingMaxDrift() {
        String skewed = hlc(NOW + 60_001L, 0, CLIENT);
        ValidationResult res = validator.validateBatch(
                CLIENT, List.of(new Op("obj_1", "x", IntNode.valueOf(1), skewed)), new LwwMap());

        assertThat(res).isInstanceOf(ValidationResult.Invalid.class);
        var inv = (ValidationResult.Invalid) res;
        assertThat(inv.code()).isEqualTo(ProtocolErrorCode.CLOCK_SKEW);
        assertThat(inv.rejectedHlcs()).containsExactly(skewed);
    }

    @Test
    void rejectsMismatchedNodeIdAndNullValuesAndUnknownFields() {
        // Mismatched nodeId
        String wrongNode = hlc(NOW, 0, "user_b");
        var resNode = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT, List.of(new Op("obj_1", "x", IntNode.valueOf(1), wrongNode)), new LwwMap());
        assertThat(resNode.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);
        assertThat(resNode.rejectedHlcs()).containsExactly(wrongNode);

        // Null value
        String nullHlc = hlc(NOW, 1, CLIENT);
        var resNull = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT, List.of(new Op("obj_1", "x", NullNode.getInstance(), nullHlc)), new LwwMap());
        assertThat(resNull.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);

        // Unknown field
        String unkHlc = hlc(NOW, 2, CLIENT);
        var resUnk = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT, List.of(new Op("obj_1", "bogusField", IntNode.valueOf(1), unkHlc)), new LwwMap());
        assertThat(resUnk.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);
    }

    @Test
    void enforcesWriteOnceTypeAndTypeSpecificFields() {
        LwwMap map = new LwwMap();
        map.apply(new Op("obj_arr", "type", TextNode.valueOf("arrow"), hlc(NOW, 0, CLIENT)));

        // Changing type from arrow -> rect is rejected
        var changeType = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT,
                List.of(new Op("obj_arr", "type", TextNode.valueOf("rect"), hlc(NOW + 1, 0, CLIENT))),
                map);
        assertThat(changeType.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);

        // Disallowed field 'w' on arrow is rejected
        var wrongField = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT,
                List.of(new Op("obj_arr", "w", IntNode.valueOf(50), hlc(NOW + 2, 0, CLIENT))),
                map);
        assertThat(wrongField.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);

        // Allowed arrow fields pass
        assertThat(validator.validateBatch(
                        CLIENT,
                        List.of(
                                new Op("obj_arr", "x2", IntNode.valueOf(200), hlc(NOW + 3, 0, CLIENT)),
                                new Op("obj_arr", "arrowHead", TextNode.valueOf("both"), hlc(NOW + 3, 1, CLIENT))),
                        map))
                .isInstanceOf(ValidationResult.Valid.class);
    }

    @Test
    void enforcesFreehandPointsLimitAndTextLengthLimit() {
        LwwMap map = new LwwMap();
        map.apply(new Op("obj_free", "type", TextNode.valueOf("freehand"), hlc(NOW, 0, CLIENT)));
        map.apply(new Op("obj_txt", "type", TextNode.valueOf("text"), hlc(NOW, 1, CLIENT)));

        ArrayNode tooManyPoints = MAPPER.createArrayNode();
        for (int i = 0; i < 2001; i++) {
            tooManyPoints.add(MAPPER.createArrayNode().add(i).add(i));
        }
        var ptsRes = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT,
                List.of(new Op("obj_free", "points", tooManyPoints, hlc(NOW + 1, 0, CLIENT))),
                map);
        assertThat(ptsRes.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);

        String tooLongText = "a".repeat(2001);
        var txtRes = (ValidationResult.Invalid) validator.validateBatch(
                CLIENT,
                List.of(new Op("obj_txt", "text", TextNode.valueOf(tooLongText), hlc(NOW + 2, 0, CLIENT))),
                map);
        assertThat(txtRes.code()).isEqualTo(ProtocolErrorCode.INVALID_FIELD);
    }

    @Test
    void enforcesBoardFullLimitIncludingDeletedObjects() {
        LimitsProperties tinyLimits = new LimitsProperties(65_536, 2, 60_000L, 60, 30, 10, 2_000, 2_000, 500, 262_144);
        OpValidator smallValidator = new OpValidator(tinyLimits, () -> NOW);

        LwwMap map = new LwwMap();
        map.apply(new Op("obj_1", "type", TextNode.valueOf("rect"), hlc(NOW, 0, CLIENT)));
        map.apply(new Op("obj_2", "type", TextNode.valueOf("rect"), hlc(NOW, 1, CLIENT)));
        map.apply(new Op("obj_2", "deleted", BooleanNode.valueOf(true), hlc(NOW, 2, CLIENT)));

        String h1 = hlc(NOW + 1, 0, CLIENT);
        String h2 = hlc(NOW + 1, 1, CLIENT);
        var res = (ValidationResult.Invalid) smallValidator.validateBatch(
                CLIENT,
                List.of(
                        new Op("obj_3", "type", TextNode.valueOf("rect"), h1),
                        new Op("obj_3", "x", IntNode.valueOf(10), h2)),
                map);
        assertThat(res.code()).isEqualTo(ProtocolErrorCode.BOARD_FULL);
        assertThat(res.rejectedHlcs()).containsExactly(h1, h2);
    }
}
