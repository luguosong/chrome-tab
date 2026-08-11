package com.personal.newtab.stockwatch;

public record StockWatchResponse(Long id, String symbol, String name, String groupName, Integer sortOrder) {
    public static StockWatchResponse of(StockWatch s) {
        return new StockWatchResponse(s.getId(), s.getSymbol(), s.getName(), s.getGroupName(), s.getSortOrder());
    }
}
