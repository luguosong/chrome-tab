package com.personal.newtab.stockwatch;

import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 观察清单 CRUD（list/create/delete）。重复 symbol 命中 uk_user_symbol →
 * DataIntegrityViolationException 由 GlobalExceptionHandler 转 409。
 */
@RestController
@RequestMapping("/api/stock-watches")
@RequiredArgsConstructor
public class StockWatchController {

    private final StockWatchRepository stockWatchRepository;

    @GetMapping
    public List<StockWatchResponse> list(@AuthenticationPrincipal User user) {
        return stockWatchRepository.findByUserIdOrderByGroupNameAscSortOrderAscIdAsc(user.getId())
                .stream().map(StockWatchResponse::of).toList();
    }

    @PostMapping
    public StockWatchResponse create(@Valid @RequestBody StockWatchRequest req,
                                     @AuthenticationPrincipal User user) {
        StockWatch w = new StockWatch();
        w.setUserId(user.getId());
        w.setSymbol(req.symbol().trim());
        w.setName(req.name().trim());
        w.setGroupName(req.groupName() != null && !req.groupName().isBlank()
                ? req.groupName().trim() : StockWatch.groupOf(req.symbol()));
        w.setSortOrder(stockWatchRepository
                .findByUserIdOrderByGroupNameAscSortOrderAscIdAsc(user.getId()).size());
        return StockWatchResponse.of(stockWatchRepository.save(w));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        stockWatchRepository.findByIdAndUserId(id, user.getId())
                .ifPresent(stockWatchRepository::delete);
    }

    public record StockWatchRequest(
            @NotBlank @Size(max = 16) String symbol,
            @NotBlank @Size(max = 64) String name,
            String groupName) {  // 可选，空则按 symbol 前缀推断
    }
}
