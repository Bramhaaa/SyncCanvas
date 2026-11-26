package com.synccanvas.protocol;

import java.util.List;

public sealed interface ValidationResult permits ValidationResult.Valid, ValidationResult.Invalid {

    record Valid() implements ValidationResult {}

    record Invalid(ProtocolErrorCode code, String message, List<String> rejectedHlcs)
            implements ValidationResult {

        public ErrorMessage toErrorMessage() {
            return new ErrorMessage(code, message, rejectedHlcs.isEmpty() ? null : rejectedHlcs);
        }
    }
}
