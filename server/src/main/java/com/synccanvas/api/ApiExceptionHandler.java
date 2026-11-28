package com.synccanvas.api;

import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ProblemDetail> handleResponseStatus(ResponseStatusException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                ex.getStatusCode(), ex.getReason() != null ? ex.getReason() : ex.getMessage());
        return ResponseEntity.status(ex.getStatusCode()).body(problem);
    }

    @ExceptionHandler(ErrorResponseException.class)
    public ResponseEntity<ProblemDetail> handleErrorResponse(ErrorResponseException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(ex.getBody());
    }
}
