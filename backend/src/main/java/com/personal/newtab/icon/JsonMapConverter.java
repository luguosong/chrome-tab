package com.personal.newtab.icon;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.Map;

/**
 * 把 icons.data（TEXT）与 Map<String,Object> 互转。
 * 不用 MySQL 原生 JSON 类型——换取 MySQL/H2 方言一致（测试用 H2 内存库 + create-drop）。
 * ObjectMapper 在 Spring 容器里是线程安全的（只读配置后），static 持有一个实例即可。
 */
@Converter
public class JsonMapConverter implements AttributeConverter<Map<String, Object>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    @Override
    public String convertToDatabaseColumn(Map<String, Object> attr) {
        if (attr == null) return null;
        try {
            return MAPPER.writeValueAsString(attr);
        } catch (Exception e) {
            throw new IllegalStateException("icons.data 序列化失败", e);
        }
    }

    @Override
    public Map<String, Object> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) return null;
        try {
            return MAPPER.readValue(dbData, MAP_TYPE);
        } catch (Exception e) {
            throw new IllegalStateException("icons.data 反序列化失败: " + dbData, e);
        }
    }
}
